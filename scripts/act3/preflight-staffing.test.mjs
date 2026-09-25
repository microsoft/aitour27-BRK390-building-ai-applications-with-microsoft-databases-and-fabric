import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyBrowserConfig } from './preflight-staffing.mjs';

const origin = 'https://function.example.test';
const tenant = '00000000-0000-0000-0000-000000000002';
const config = { origin, tenant };
const valid = {
  tenantId: tenant,
  clientId: '00000000-0000-0000-0000-000000000003',
  apiScope: 'api://00000000-0000-0000-0000-000000000004/access_as_user',
  redirectUri: `${origin}/api/app`,
  silentRedirectUri: `${origin}/api/auth-redirect`,
};
const responseFor = value => async () => Response.json(value);

test('browser config succeeds anonymously with the approved origin and exact callbacks', async () => {
  await verifyBrowserConfig(config, async (url, options) => {
    assert.equal(url, `${origin}/api/config`);
    assert.deepEqual(options.headers, {});
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(valid);
  });
  await verifyBrowserConfig(config, responseFor({ ...valid, apiScope: 'https://api.example.test/access_as_user' }));
});

test('config non-200 responses fail before reading potentially sensitive bodies', async () => {
  for (const status of [204, 301, 302, 401, 403, 404, 500, 503]) {
    await assert.rejects(verifyBrowserConfig(config, async () => ({
      status,
      json() { throw new Error('sensitive-response-body'); },
    })), error => {
      assert.match(error.message, /HTTP 200/);
      assert.match(error.message, /ACT3_REDIRECT_URI/);
      assert.doesNotMatch(error.message, /sensitive-response-body/);
      return true;
    });
  }
});

test('CLI fails before dependency checks when browser config is broken, without printing secrets', () => {
  const setup = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.execFileSync = () => JSON.stringify({
      id: process.env.AZURE_SUBSCRIPTION_ID, tenantId: process.env.ENTRA_TENANT_ID, state: 'Enabled',
    });
    childProcess.execFile = () => { throw new Error('Unexpected dependency access'); };
    syncBuiltinESMExports();
    globalThis.fetch = async (url, options) => {
      if (!url.endsWith('/api/config') || Object.keys(options.headers).length) {
        throw new Error('Unexpected request');
      }
      return new Response('private-token tenant-internal-detail', { status: 500 });
    };
  `;
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(setup)}`,
    fileURLToPath(new URL('./preflight-staffing.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 10_000,
    env: {
      AZURE_SUBSCRIPTION_ID: '00000000-0000-0000-0000-000000000001', ENTRA_TENANT_ID: tenant,
      AZURE_RESOURCE_GROUP: 'test-group', AZURE_FUNCTION_APP: 'test-function',
      ACT3_SQL_SERVER: 'test-sql.database.windows.net', ACT3_SQL_DATABASE: 'TestDatabase',
    },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /FAIL staffing preflight: browser configuration/);
  assert.match(result.stderr, /HTTP 200/);
  assert.match(result.stderr, /ACT3_REDIRECT_URI application settings/);
  assert.doesNotMatch(result.stderr, /private-token|tenant-internal-detail|Unexpected|PASS/);
});

test('network, timeout, redirect and JSON failures have static sanitized diagnostics', async () => {
  for (const message of ['Bearer private-token', 'timeout private-token', 'redirect https://private-token.example.test']) {
    await assert.rejects(verifyBrowserConfig(config, async () => { throw new Error(message); }), error => {
      assert.match(error.message, /GET \/api\/config failed or redirected/);
      assert.doesNotMatch(error.message, /private-token/);
      return true;
    });
  }
  await assert.rejects(verifyBrowserConfig(config, async () => ({
    status: 200, json() { throw new SyntaxError('private-token'); },
  })), error => {
    assert.match(error.message, /valid JSON/);
    assert.doesNotMatch(error.message, /private-token/);
    return true;
  });
});

test('browser config requires an object and every nonempty string field', async () => {
  for (const value of [null, [], true, 'private-token', 42]) {
    await assert.rejects(verifyBrowserConfig(config, responseFor(value)), /configuration object/);
  }
  for (const field of Object.keys(valid)) {
    for (const value of [undefined, null, '', ' ', ` ${valid[field]}`, 42]) {
      await assert.rejects(verifyBrowserConfig(config, responseFor({ ...valid, [field]: value })),
        new RegExp(`invalid ${field}`));
    }
  }
});

test('auth identifiers, operator tenant and delegated scope must be valid', async () => {
  for (const field of ['tenantId', 'clientId']) {
    await assert.rejects(verifyBrowserConfig(config, responseFor({ ...valid, [field]: 'private-token' })), /valid identifiers/);
  }
  await assert.rejects(verifyBrowserConfig(config, responseFor({ ...valid, tenantId: valid.clientId })), /operator tenant/);
  for (const apiScope of ['not-a-uri', 'access_as_user', 'http://api.example.test/scope', 'api://host',
    'https://user:private-token@api.example.test/scope', 'api://host/scope?token=private-token',
    'api://host/scope#private-token', 'api://host/two scopes']) {
    await assert.rejects(verifyBrowserConfig(config, responseFor({ ...valid, apiScope })), error => {
      assert.match(error.message, /delegated scope URI/);
      assert.doesNotMatch(error.message, /private-token/);
      return true;
    });
  }
});

test('redirects reject foreign origins, wrong paths and token-bearing URL components without disclosure', async () => {
  for (const [field, path] of [['redirectUri', '/api/app'], ['silentRedirectUri', '/api/auth-redirect']]) {
    for (const value of [`https://foreign.example.test${path}`, `${origin}.foreign.example.test${path}`,
      `http://function.example.test${path}`, `${origin}:444${path}`, `${origin}/wrong`, path,
      `${origin}${path}/`, `${origin}${path}?token=private-token`, `${origin}${path}#private-token`,
      `https://user:private-token@function.example.test${path}`, `${origin}/other/..${path}`, 'not-a-url']) {
      await assert.rejects(verifyBrowserConfig(config, responseFor({ ...valid, [field]: value })), error => {
        assert.match(error.message, new RegExp(`${field} must use the exact`));
        assert.match(error.message, /already-approved SPA/);
        assert.doesNotMatch(error.message, /private-token|foreign\.example\.test/);
        return true;
      });
    }
  }
});