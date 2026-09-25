import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { loadDeploymentConfig, verifyAzureContext } from './config.mjs';

export async function verifyBrowserConfig({ origin, tenant }, fetchConfig = fetch) {
  const settingsHint = 'Check deployed ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_API_SCOPE and ACT3_REDIRECT_URI application settings; publishing code does not copy local settings.';
  const redirectHint = 'Set deployed ACT3_REDIRECT_URI to the already-approved SPA /api/app URL on the configured Function origin; verify /api/auth-redirect is also registered. Do not change app registrations automatically.';
  let response;
  try {
    response = await fetchConfig(`${origin}/api/config`, {
      headers: {}, signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
  } catch {
    assert.fail(`GET /api/config failed or redirected. Check Function availability and anonymous route access. ${settingsHint}`);
  }
  assert.equal(response.status, 200, `GET /api/config must return HTTP 200. ${settingsHint}`);
  let browserConfig;
  try {
    browserConfig = await response.json();
  } catch {
    assert.fail(`GET /api/config must return valid JSON. ${settingsHint}`);
  }
  assert.ok(browserConfig && typeof browserConfig === 'object' && !Array.isArray(browserConfig),
    `GET /api/config must return a configuration object. ${settingsHint}`);
  for (const field of ['tenantId', 'clientId', 'apiScope', 'redirectUri', 'silentRedirectUri']) {
    assert.ok(typeof browserConfig[field] === 'string' && browserConfig[field].trim()
      && browserConfig[field] === browserConfig[field].trim(),
    `GET /api/config is missing or has an invalid ${field}. ${settingsHint}`);
  }
  const guid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  assert.ok(guid.test(browserConfig.tenantId) && guid.test(browserConfig.clientId),
    `GET /api/config tenantId and clientId must be valid identifiers. ${settingsHint}`);
  assert.ok(browserConfig.tenantId.toLowerCase() === tenant.toLowerCase(),
    `GET /api/config tenantId must match the configured operator tenant. ${settingsHint}`);
  let scope;
  try {
    scope = new URL(browserConfig.apiScope);
  } catch {
    assert.fail(`GET /api/config apiScope must be an absolute delegated scope URI. ${settingsHint}`);
  }
  assert.ok(['api:', 'https:'].includes(scope.protocol) && scope.hostname
    && scope.pathname.length > 1 && !scope.username && !scope.password && !scope.search && !scope.hash
    && !/\s/.test(browserConfig.apiScope),
  `GET /api/config apiScope must be an absolute delegated scope URI. ${settingsHint}`);
  for (const [field, path] of [['redirectUri', '/api/app'], ['silentRedirectUri', '/api/auth-redirect']]) {
    assert.ok(browserConfig[field] === `${origin}${path}`,
      `GET /api/config ${field} must use the exact ${path} URL on the configured Function origin, with no credentials, query or fragment. ${redirectHint}`);
  }
}

async function main() {
  const execute = promisify(execFile);
  const config = loadDeploymentConfig();
  const { subscription, group, functionName: name, origin } = config;
  const server = config.sqlServer.split('.')[0];
  const resource = `/subscriptions/${subscription}/resourceGroups/${group}`;
  let phase = 'Azure access';
  async function azure(args) {
    const { stdout } = await execute('az', [...args, '--subscription', subscription, '-o', 'json'], { timeout: 60_000 });
    return JSON.parse(stdout);
  }
  async function request(path, headers = {}) {
    return fetch(`${origin}/api/${path}`, { headers, signal: AbortSignal.timeout(120_000), redirect: 'error' });
  }

  try {
    verifyAzureContext(config);
    phase = 'browser configuration';
    await verifyBrowserConfig(config);
    console.log('PASS browser configuration: HTTP 200, required auth fields and same-origin redirects.');
    phase = 'anonymous access protection';
    for (const path of ['staffing-readiness', 'staffing/snapshot', 'review/case']) {
      assert.equal((await request(path)).status, 401, path);
    }
    phase = 'deployed staffing assets';
    for (const [path, file] of [['staffing-app', 'staffing.html'], ['assets/staffing.js', 'staffing.js'], ['assets/staffing.css', 'staffing.css']]) {
      const response = await request(path);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), await readFile(new URL(`../../src/act3/web/${file}`, import.meta.url), 'utf8'));
    }
    phase = 'protected SQL and Cosmos readiness';
    const keys = await azure(['rest', '--method', 'post', '--url',
      `https://management.azure.com${resource}/providers/Microsoft.Web/sites/${name}/host/default/listkeys?api-version=2024-04-01`]);
    assert.ok(keys.functionKeys?.default);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await request('staffing-readiness', { 'x-functions-key': keys.functionKeys.default });
      const result = await response.json();
      assert.equal(response.status, 200, `Dependency unavailable: ${result.dependency || 'unknown'}`);
      assert.equal(result.ready, true);
      console.log(`PASS live dependencies ${attempt}/3: ${result.durationMs} ms`);
    }
    phase = 'SQL quota headroom';
    const database = await azure(['sql', 'db', 'show', '-g', group, '-s', server, '-n', config.sqlDatabase]);
    if (database.useFreeLimit && database.freeLimitExhaustionBehavior === 'AutoPause') {
      const metrics = await azure(['monitor', 'metrics', 'list', '--resource',
        `${resource}/providers/Microsoft.Sql/servers/${server}/databases/${config.sqlDatabase}`,
        '--metric', 'free_amount_remaining', '--aggregation', 'Minimum', '--interval', 'PT15M', '--offset', '2h']);
      const points = metrics.value.flatMap(metric => metric.timeseries.flatMap(series => series.data))
        .filter(point => Number.isFinite(point.minimum)).sort((first, second) => Date.parse(second.timeStamp) - Date.parse(first.timeStamp));
      const latest = points[0];
      assert.ok(latest && Date.now() - Date.parse(latest.timeStamp) < 3_600_000, 'No recent quota metric');
      const reserve = Number(database.sku.capacity) * 2 * 3_600;
      assert.ok(Number.isFinite(reserve) && latest.minimum >= reserve, 'Less than two hours of maximum-compute headroom');
      console.log(`PASS SQL quota: ${latest.minimum} vCore-seconds remaining at ${latest.timeStamp}; required reserve ${reserve}`);
    }
    console.log('PASS backend preflight: browser configuration, assets, access guards, SQL and Cosmos. No business writes.');
    console.log('Not verified here: interactive speaker sign-in, role assignments, embedding retrieval, or a real paused-database resume.');
  } catch (error) {
    console.error(`FAIL staffing preflight: ${phase}.`);
    if (error instanceof assert.AssertionError && phase !== 'deployed staffing assets') console.error(error.message);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();