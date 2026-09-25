import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {validateStaffingMemory} from '../../src/act3/staffing.ts';

class PreparationError extends Error {}

function fail(message) {
  throw new PreparationError(message);
}

export function requireMemoryWrite(env = process.env) {
  for (const name of ['CALDOVA_ALLOW_CLOUD_WRITES', 'CALDOVA_SYNTHETIC_SOURCE_CONFIRMED']) {
    if (env[name] !== 'true') fail(`Writing requires ${name}=true.`);
  }
}

export function staffingMemoryDocument(scenario) {
  let document;
  try {
    document = validateStaffingMemory(scenario?.rehearsalMemory);
  } catch {
    fail('The generated scenario must contain valid V3 rehearsalMemory.');
  }
  for (const value of [document.id, document.caseId]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value)) fail('Invalid memory identifier.');
  }
  if (document.id !== scenario?.case?.memoryId || document.caseId !== scenario?.case?.memoryPartition) {
    fail('Memory id and caseId must match the scenario case memoryId and memoryPartition.');
  }
  return document;
}

export function staffingMemoryHash(memory) {
  return createHash('sha256').update(JSON.stringify(validateStaffingMemory(memory))).digest('hex');
}

function summary(document, mode) {
  return {mode, synthetic: true, schemaVersion: document.schemaVersion, dataClass: document.dataClass,
    id: document.id, caseId: document.caseId, hash: staffingMemoryHash(document)};
}

function statusCode(error) {
  const value = error?.statusCode ?? error?.code;
  return value === 404 || value === '404' ? 404 : value === 409 || value === '409' ? 409 : undefined;
}

export async function prepareStaffingMemory(container, scenario, env = process.env) {
  requireMemoryWrite(env);
  const document = staffingMemoryDocument(scenario);
  const expectedHash = staffingMemoryHash(document);
  const inspect = `Inspect ID ${document.id} in caseId partition ${document.caseId}; do not replay the write.`;
  const conflict = `The memory ID already exists or conflicts. Nothing was overwritten. ${inspect}`;
  let existing;
  try {
    existing = await container.item(document.id, document.caseId).read();
  } catch (error) {
    if (statusCode(error) === 409) fail(conflict);
    if (statusCode(error) !== 404) fail(`Memory pre-read failed; no create attempted. ${inspect}`);
    existing = {statusCode: 404};
  }
  if (existing?.resource) fail(conflict);
  if (statusCode(existing) === 409) fail(conflict);
  if (statusCode(existing) !== 404) fail(`Memory absence was not confirmed; no create attempted. ${inspect}`);

  let created;
  try {
    created = await container.items.create(document);
  } catch (error) {
    if (statusCode(error) === 409) fail(conflict);
    fail(`Insert outcome unknown. ${inspect}`);
  }
  if (created?.statusCode !== 201) fail(`Insert outcome unknown. ${inspect}`);
  try {
    const {resource} = await container.item(document.id, document.caseId).read();
    const memory = validateStaffingMemory(resource?.staffingMemory ?? resource);
    if (resource.id !== document.id || resource.caseId !== document.caseId || memory.id !== document.id
      || memory.caseId !== document.caseId || staffingMemoryHash(memory) !== expectedHash) {
      throw new Error('Readback mismatch');
    }
  } catch {
    fail(`Insert acknowledged, but readback is unverified or differs. ${inspect}`);
  }
  return {...summary(document, 'observed-insert-readback'),
    message: 'One synthetic document inserted and its canonical hash verified by readback. Existing documents were not changed.'};
}

export function cosmosMemoryTarget(env = process.env) {
  const target = {};
  for (const [field, name] of Object.entries({endpoint: 'ACT3_COSMOS_ENDPOINT',
    database: 'ACT3_COSMOS_DATABASE', container: 'ACT3_COSMOS_CONTAINER'})) {
    const value = env[name]?.trim();
    if (!value) fail(`${name} is required; there is no default target.`);
    target[field] = value;
  }
  let endpoint;
  try { endpoint = new URL(target.endpoint); } catch { fail('Invalid Cosmos endpoint.'); }
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.documents\.azure\.com$/.test(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || target.endpoint.includes('?') || target.endpoint.includes('#')
    || endpoint.pathname !== '/' || endpoint.port) {
    fail('Use an HTTPS *.documents.azure.com account endpoint without credentials, path, port, query or fragment.');
  }
  for (const field of ['database', 'container']) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(target[field])) fail(`Invalid Cosmos ${field} name.`);
  }
  return {...target, endpoint: endpoint.origin};
}

export async function openStaffingMemoryContainer(env = process.env, adapters = {}) {
  requireMemoryWrite(env);
  const target = cosmosMemoryTarget(env);
  const {loadDeploymentConfig, verifyAzureContext} = await import('./config.mjs');
  const config = loadDeploymentConfig(env);
  try {
    await (adapters.verifyContext ?? verifyAzureContext)(config);
    const {CosmosClient, AzureCliCredential} = await (adapters.loadSdk ?? (async () => {
      const cosmos = await import('@azure/cosmos');
      const identity = await import('@azure/identity');
      return {CosmosClient: cosmos.CosmosClient, AzureCliCredential: identity.AzureCliCredential};
    }))();
    const client = new CosmosClient({endpoint: target.endpoint,
      aadCredentials: new AzureCliCredential({tenantId: config.tenant}),
      connectionPolicy: {requestTimeout: 15000, enableEndpointDiscovery: false,
        enableBackgroundEndpointRefreshing: false, useMultipleWriteLocations: false,
        enablePartitionLevelFailover: false, enablePartitionLevelCircuitBreaker: false,
        retryOptions: {maxRetryAttemptCount: 0, maxWaitTimeInSeconds: 0}}});
    return {container: client.database(target.database).container(target.container), close: () => client.dispose()};
  } catch {
    fail('Azure context verification or Cosmos client setup failed; no create attempted. Check the configured tenant, subscription and existing Azure CLI login.');
  }
}

export function readGeneratedStaffingScenario() {
  try {
    execFileSync(process.execPath, [new URL('./build-staffing-scenario.mjs', import.meta.url).pathname, '--check'],
      {stdio: 'pipe'});
    return JSON.parse(readFileSync(new URL('../../src/act3/staffing-scenario.json', import.meta.url), 'utf8'));
  } catch {
    fail('Generated staffing scenario is missing, invalid or stale. Run npm run demo:scenario:check locally.');
  }
}

export async function main(args = process.argv.slice(2), env = process.env, adapters = {}) {
  if (args.length === 1 && args[0] === '--help') {
    return {usage: 'node scripts/act3/prepare-staffing-memory.mjs [--write]',
      message: 'Default: local synthetic preview, no credentials or cloud imports. --write requires CALDOVA_ALLOW_CLOUD_WRITES=true and CALDOVA_SYNTHETIC_SOURCE_CONFIRMED=true, existing deployment configuration and explicit ACT3_COSMOS_ENDPOINT/DATABASE/CONTAINER. Uses the configured tenant/subscription and existing Azure CLI Entra login only. An uncertain write requires inspection of the document ID and caseId partition; never replay it.'};
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--write')) fail('Usage: prepare-staffing-memory.mjs [--write]');
  const write = args[0] === '--write';
  if (write) requireMemoryWrite(env);
  const scenario = await (adapters.loadScenario ?? readGeneratedStaffingScenario)();
  const document = staffingMemoryDocument(scenario);
  if (!write) return {...summary(document, 'preview'), message: 'Local preview only. No cloud access or credentials used.'};
  const {container, close} = await (adapters.openContainer ?? openStaffingMemoryContainer)(env);
  try {
    return await prepareStaffingMemory(container, scenario, env);
  } finally {
    close();
  }
}

if (import.meta.main) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error instanceof PreparationError ? error.message
      : 'Memory preparation failed or its outcome is unknown. Inspect the generated memory ID and caseId partition; do not replay the write.');
    process.exitCode = 1;
  });
}