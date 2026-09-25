import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {validateStaffingMemory} from '../../src/act3/staffing.ts';
import {cosmosMemoryTarget, main, openStaffingMemoryContainer, prepareStaffingMemory,
  staffingMemoryDocument, staffingMemoryHash} from './prepare-staffing-memory.mjs';

const scenario = JSON.parse(readFileSync(new URL('../../src/act3/staffing-scenario.json', import.meta.url), 'utf8'));
const allowed = {CALDOVA_ALLOW_CLOUD_WRITES: 'true', CALDOVA_SYNTHETIC_SOURCE_CONFIRMED: 'true'};
const target = {ACT3_COSMOS_ENDPOINT: 'https://example.documents.azure.com',
  ACT3_COSMOS_DATABASE: 'demo', ACT3_COSMOS_CONTAINER: 'memory'};
const deployment = {...allowed, ...target, AZURE_SUBSCRIPTION_ID: '00000000-0000-0000-0000-000000000001',
  ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000002', AZURE_RESOURCE_GROUP: 'test-group',
  AZURE_FUNCTION_APP: 'test-function', ACT3_SQL_SERVER: 'example.database.windows.net', ACT3_SQL_DATABASE: 'demo'};
const secretError = code => Object.assign(new Error('PRIVATE_AUTH_SENTINEL'), {code});

function fixture({before, createError, createStatus = 201, after} = {}) {
  const calls = [];
  const document = staffingMemoryDocument(scenario);
  let reads = 0;
  const container = {
    item(id, partition) {
      assert.equal(id, document.id);
      assert.equal(partition, document.caseId);
      return {async read() {
        calls.push('read');
        reads++;
        const result = reads === 1 ? (before ?? secretError(404)) : (after ?? {resource: {...document, _etag: 'test-etag'}});
        if (result instanceof Error) throw result;
        return result;
      }};
    },
    items: {async create(...args) {
      calls.push('create');
      assert.equal(args.length, 1);
      assert.deepEqual(args[0], validateStaffingMemory(scenario.rehearsalMemory));
      assert.equal(args[0].id, scenario.case.memoryId);
      assert.equal(args[0].caseId, scenario.case.memoryPartition);
      if (createError) throw createError;
      return {statusCode: createStatus};
    }},
  };
  return {calls, container, run: (env = allowed) => prepareStaffingMemory(container, scenario, env)};
}

test('404 permits exactly one canonical create, followed by matching observed readback', async () => {
  const {calls, run} = fixture();
  const result = await run();
  assert.deepEqual(calls, ['read', 'create', 'read']);
  assert.equal(result.mode, 'observed-insert-readback');
  assert.equal(result.synthetic, true);
  assert.equal(result.hash, createHash('sha256').update(JSON.stringify(validateStaffingMemory(scenario.rehearsalMemory))).digest('hex'));
  assert.ok(!JSON.stringify(result).includes(scenario.rehearsalMemory.lesson));
});

test('404 response and matching wrapper readback are supported', async () => {
  const memory = staffingMemoryDocument(scenario);
  const {run, calls} = fixture({before: {statusCode: 404},
    after: {resource: {id: memory.id, caseId: memory.caseId, staffingMemory: memory}}});
  await run();
  assert.deepEqual(calls, ['read', 'create', 'read']);
});

test('existing equal, different, and pre-read 409 records never create', async () => {
  for (const before of [{resource: scenario.rehearsalMemory}, {resource: {id: 'different'}},
    secretError(409), {statusCode: 409}]) {
    const {run, calls} = fixture({before});
    await assert.rejects(run, /already exists or conflicts/);
    assert.deepEqual(calls, ['read']);
  }
});

test('only explicit 404 proves absence; unknown pre-read failures stay sanitized', async () => {
  for (const before of [secretError('ETIMEDOUT'), secretError(403), secretError(500), {}, {resource: undefined}]) {
    const {run, calls} = fixture({before});
    await assert.rejects(run, error => /no create attempted/.test(error.message) && !error.message.includes('PRIVATE_AUTH_SENTINEL'));
    assert.deepEqual(calls, ['read']);
  }
});

test('racing create 409 rejects without overwrite, retry or readback', async () => {
  const {run, calls} = fixture({createError: secretError('409')});
  await assert.rejects(run, /already exists or conflicts/);
  assert.deepEqual(calls, ['read', 'create']);
});

test('timeout and unknown create outcomes never retry and require ID inspection', async () => {
  for (const options of [{createError: secretError('ETIMEDOUT')}, {createError: secretError(503)}, {createStatus: 200}]) {
    const {run, calls} = fixture(options);
    await assert.rejects(run, error => error.message.includes('Insert outcome unknown')
      && error.message.includes(scenario.case.memoryId) && error.message.includes(scenario.case.memoryPartition)
      && error.message.includes('do not replay') && !error.message.includes('PRIVATE_AUTH_SENTINEL'));
    assert.deepEqual(calls, ['read', 'create']);
  }
});

test('readback failure, canonical mismatch and mismatched wrapper identifiers never replay', async () => {
  const memory = staffingMemoryDocument(scenario);
  for (const after of [secretError(404), secretError('ETIMEDOUT'), {},
    {resource: {...memory, lesson: 'Different retained lesson'}},
    {resource: {...memory, id: 'other'}}, {resource: {...memory, caseId: 'other'}},
    {resource: {id: memory.id, caseId: memory.caseId, staffingMemory: {...memory, id: 'other'}}}]) {
    const {run, calls} = fixture({after});
    await assert.rejects(run, /Insert acknowledged, but readback is unverified or differs.*do not replay/);
    assert.deepEqual(calls, ['read', 'create', 'read']);
  }
});

test('each exact write guard is required before container access or imports', async () => {
  for (const name of Object.keys(allowed)) {
    for (const value of [undefined, 'false', 'TRUE', '1', true]) {
      const env = {...allowed, [name]: value};
      const {run, calls} = fixture();
      await assert.rejects(() => run(env), new RegExp(name));
      await assert.rejects(() => openStaffingMemoryContainer(env), new RegExp(name));
      await assert.rejects(() => main(['--write'], env, {loadScenario() { assert.fail('guard must precede source loading'); }}), new RegExp(name));
      assert.deepEqual(calls, []);
    }
  }
});

test('invalid or missing V3 memory and mismatched case references fail before any access', async () => {
  for (const change of [{rehearsalMemory: undefined}, {rehearsalMemory: {...scenario.rehearsalMemory, schemaVersion: 2}},
    {case: {...scenario.case, memoryId: 'other'}}, {case: {...scenario.case, memoryPartition: 'other'}}]) {
    await assert.rejects(() => main(['--write'], allowed, {loadScenario: () => ({...scenario, ...change}),
      openContainer() { assert.fail('invalid memory cannot open Cosmos'); }}));
    assert.throws(() => staffingMemoryDocument({...scenario, ...change}));
  }
});

test('preview with absent Cosmos source configuration has no cloud imports or credential requirement', () => {
  const script = new URL('./prepare-staffing-memory.mjs', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {registerHooks} from 'node:module';
    registerHooks({resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@azure/') || /(?:staffing-admin|staffing-memory|config)\\.mjs$/.test(specifier) && specifier !== ${JSON.stringify(script)}) {
        throw new Error('Cloud import during preview');
      }
      return nextResolve(specifier, context);
    }});
    const {main} = await import(${JSON.stringify(script)});
    console.log(JSON.stringify(await main([], {})));
  `], {encoding: 'utf8', env: {PATH: process.env.PATH}});
  assert.equal(JSON.parse(output).mode, 'preview');
  const cli = execFileSync(process.execPath, [new URL('./prepare-staffing-memory.mjs', import.meta.url).pathname],
    {encoding: 'utf8', env: {PATH: process.env.PATH}});
  assert.equal(JSON.parse(cli).hash, staffingMemoryHash(scenario.rehearsalMemory));
});

test('write flags alone never turn the default preview into a cloud call', async () => {
  const result = await main([], allowed, {loadScenario: () => scenario,
    openContainer() { assert.fail('preview cannot open Cosmos'); }});
  assert.equal(result.mode, 'preview');
});

test('all destination settings are explicit and endpoints reject auth, queries, fragments and lookalikes', () => {
  for (const name of Object.keys(target)) assert.throws(() => cosmosMemoryTarget({...target, [name]: ''}), new RegExp(name));
  for (const endpoint of ['http://example.documents.azure.com', 'https://documents.azure.com',
    'https://example.documents.azure.com.attacker.test', 'https://user:password@example.documents.azure.com',
    ['https://user', 'example.documents.azure.com'].join('@'), 'https://example.documents.azure.com?key=private',
    'https://example.documents.azure.com#private', 'https://example.documents.azure.com?',
    'https://example.documents.azure.com#', 'https://example.documents.azure.com/path',
    'https://example.documents.azure.com:8080', 'not a URL']) {
    assert.throws(() => cosmosMemoryTarget({...target, ACT3_COSMOS_ENDPOINT: endpoint}));
  }
  assert.deepEqual(cosmosMemoryTarget(target), {endpoint: target.ACT3_COSMOS_ENDPOINT, database: 'demo', container: 'memory'});
});

test('write setup verifies tenant and subscription before acquiring a tenant-only CLI token', async () => {
  const calls = [];
  const container = {};
  let options;
  const opened = await openStaffingMemoryContainer(deployment, {
    verifyContext(config) { calls.push('verify'); assert.equal(config.tenant, deployment.ENTRA_TENANT_ID); assert.equal(config.subscription, deployment.AZURE_SUBSCRIPTION_ID); },
    async loadSdk() {
      calls.push('sdk');
      return {
        AzureCliCredential: class { constructor(config) {
          assert.deepEqual(config, {tenantId: deployment.ENTRA_TENANT_ID});
        }},
        CosmosClient: class { constructor(config) { options = config; }
          database(name) { assert.equal(name, 'demo'); return {container(name) { assert.equal(name, 'memory'); return container; }}; }
          dispose() { calls.push('close'); }
        },
      };
    },
  });
  assert.deepEqual(calls, ['verify', 'sdk']);
  assert.equal(opened.container, container);
  assert.deepEqual(Object.keys(options).sort(), ['aadCredentials', 'connectionPolicy', 'endpoint']);
  assert.equal(options.connectionPolicy.retryOptions.maxRetryAttemptCount, 0);
  assert.equal(options.connectionPolicy.enableEndpointDiscovery, false);
  assert.equal(options.connectionPolicy.enablePartitionLevelFailover, false);
  assert.equal(options.connectionPolicy.useMultipleWriteLocations, false);
  opened.close();
  assert.equal(calls.at(-1), 'close');
  await assert.rejects(() => openStaffingMemoryContainer(deployment, {
    verifyContext() { throw secretError(403); }, loadSdk() { assert.fail('unverified context cannot load SDK'); },
  }), error => /context verification/.test(error.message) && !error.message.includes('PRIVATE_AUTH_SENTINEL'));
  await assert.rejects(() => openStaffingMemoryContainer({...allowed, ...target}), /AZURE_SUBSCRIPTION_ID is required/);
});

test('CLI orchestration closes its client after success or unknown write, and rejects unknown flags', async () => {
  for (const createError of [undefined, secretError('ETIMEDOUT')]) {
    const {container, calls} = fixture({createError});
    const run = () => main(['--write'], allowed, {loadScenario: () => scenario,
      openContainer: () => ({container, close() { calls.push('close'); }})});
    if (createError) await assert.rejects(run, /outcome unknown/);
    else assert.equal((await run()).mode, 'observed-insert-readback');
    assert.equal(calls.at(-1), 'close');
  }
  await assert.rejects(() => main(['--upsert']), /Usage/);
  assert.match((await main(['--help'])).message, /never replay/);
});