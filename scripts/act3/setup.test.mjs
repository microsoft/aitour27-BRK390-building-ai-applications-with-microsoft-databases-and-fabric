import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeSetup, seedSteps, validateSetup } from './setup.mjs';

const env = {
  AZURE_SUBSCRIPTION_ID: '00000000-0000-0000-0000-000000000001', ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000002',
  ENTRA_CLIENT_ID: '00000000-0000-0000-0000-000000000003', AZURE_RESOURCE_GROUP: 'test-group', AZURE_FUNCTION_APP: 'test-app',
  ACT3_SQL_SERVER: 'test-sql.database.windows.net', ACT3_SQL_DATABASE: 'TestDatabase', ENTRA_API_AUDIENCE: 'test-api',
  ENTRA_API_SCOPE: 'api://test-api/Act3.Access', ACT3_EMBEDDING_ENDPOINT: 'https://test-only.openai.azure.com',
  ACT3_EMBEDDING_DEPLOYMENT: 'test-model', ACT3_EMBEDDING_PROFILE: 'test-profile', ACT3_GUIDANCE_MAX_DISTANCE: '0.3',
  ACT3_COSMOS_ENDPOINT: 'https://test-only.documents.azure.com', ACT3_COSMOS_DATABASE: 'test', ACT3_COSMOS_CONTAINER: 'cases',
  ACT3_STAFFING_CASE_ID: 'TEST-CASE', ACT3_REDIRECT_URI: 'https://test-app.azurewebsites.net/api/app',
};

test('speaker setup checks all required settings offline before any subprocess', () => {
  const execute = () => { throw new Error('Unexpected subprocess'); };
  assert.deepEqual(executeSetup('--check', env, execute), { checked: true, cloudWrites: false, steps: seedSteps });
  for (const name of Object.keys(env)) assert.throws(() => validateSetup({ ...env, [name]: '' }), name);
  for (const value of ['http://test-only.documents.azure.com', 'https://test-only.documents.azure.com.evil.test',
    'https://test-only.documents.azure.com/path', 'https://test-only.documents.azure.com?key=value']) {
    assert.throws(() => validateSetup({ ...env, ACT3_COSMOS_ENDPOINT: value }));
  }
  assert.throws(() => validateSetup({ ...env, ACT3_REDIRECT_URI: 'https://other.example.test/api/app' }));
});

test('speaker seeding requires explicit consent and stops immediately on failed stage', () => {
  const calls = [];
  const execute = (command, args) => {
    calls.push({ command, args });
    if (command === 'az') return JSON.stringify({ id: env.AZURE_SUBSCRIPTION_ID, tenantId: env.ENTRA_TENANT_ID, state: 'Enabled' });
    if (args[0].endsWith('prepare-staffing-memory.mjs')) {
      assert.deepEqual(args.slice(1), ['--write']);
      throw new Error('Memory conflict');
    }
  };
  assert.throws(() => executeSetup('--seed', env, execute), /mutates/);
  assert.equal(calls.length, 0);
  const allowed = { ...env, CALDOVA_ALLOW_CLOUD_WRITES: 'true', CALDOVA_SYNTHETIC_SOURCE_CONFIRMED: 'true' };
  assert.throws(() => executeSetup('--seed', allowed, execute), /Memory conflict/);
  assert.equal(calls.length, 3);
  assert.ok(calls[2].args[0].endsWith('prepare-staffing-memory.mjs'));
});