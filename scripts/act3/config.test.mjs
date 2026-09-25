import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDeploymentConfig, requireCloudWrite, verifyAzureContext } from './config.mjs';

const env = { AZURE_SUBSCRIPTION_ID: '00000000-0000-0000-0000-000000000001',
  ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000002', AZURE_RESOURCE_GROUP: 'test-group',
  AZURE_FUNCTION_APP: 'test-function', ACT3_SQL_SERVER: 'test-sql.database.windows.net', ACT3_SQL_DATABASE: 'TestDatabase' };

test('deployment configuration requires explicit operator-owned settings', () => {
  assert.throws(() => loadDeploymentConfig({}), /required/);
  assert.equal(loadDeploymentConfig(env).origin, 'https://test-function.azurewebsites.net');
  assert.throws(() => loadDeploymentConfig({ ...env, ACT3_SQL_SERVER: 'attacker.test' }), /hostname/);
  assert.throws(() => loadDeploymentConfig({ ...env, AZURE_FUNCTION_APP: 'host/path' }), /name/);
});

test('tenant checks and explicit write opt-in fail closed', () => {
  const config = loadDeploymentConfig(env);
  assert.throws(() => requireCloudWrite({}), /mutates/);
  requireCloudWrite({ CALDOVA_ALLOW_CLOUD_WRITES: 'true' });
  const account = { id: config.subscription, tenantId: config.tenant, state: 'Enabled' };
  verifyAzureContext(config, (command, args) => { assert.ok(args.includes(config.subscription)); return JSON.stringify(account); });
  assert.throws(() => verifyAzureContext(config, () => JSON.stringify({ ...account, tenantId: 'wrong' })), /mismatch/);
});