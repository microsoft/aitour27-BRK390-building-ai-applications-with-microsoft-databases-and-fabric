import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStaffingReadiness } from './staffing-readiness.mjs';

test('readiness verifies case, capacity and Cosmos without writes or exposed data', async () => {
  const queries: string[] = [];
  const handler = createStaffingReadiness({ caseId: 'configured-case',
    resources: async () => ({ pool: { request: () => ({ input: () => ({ query: async (query: string) => {
      queries.push(query); return { recordsets: [[{ memoryId: 'source', memoryPartition: 'partition' }], [{ optionCount: 3, eligibleCount: 1 }]] };
    } }) }) } }),
    readMemory: async (id: string, partition: string) => { assert.equal(id, 'source'); assert.equal(partition, 'partition'); },
  });
  const result = await handler();
  assert.equal(result.status, 200); assert.equal(result.jsonBody.ready, true);
  assert.match(queries.join(' '), /SUM\(CASE WHEN eligible=1 THEN 1 ELSE 0 END\) AS eligibleCount/);
  assert.doesNotMatch(queries.join(' '), /INSERT|UPDATE|DELETE|EXEC/i);
  assert.doesNotMatch(JSON.stringify(result), /configured-case|partition|memoryId/);
});

test('readiness fails closed and does not expose SQL errors', async () => {
  const handler = createStaffingReadiness({ caseId: 'configured-case', resources: async () => { throw new Error('private connection details'); }, readMemory: async () => {} });
  const result = await handler();
  assert.equal(result.status, 503); assert.equal(result.jsonBody.dependency, 'sql');
  assert.doesNotMatch(JSON.stringify(result), /private connection/);
});

test('readiness rejects missing cases and reports Cosmos failures without exposing details', async () => {
  for (const missing of [true, false]) {
    let reads = 0;
    const handler = createStaffingReadiness({ caseId: 'configured-case',
      resources: async () => ({ pool: { request: () => ({ input: () => ({ query: async () => ({
        recordsets: [missing ? [] : [{ memoryId: 'source', memoryPartition: 'partition' }], [{ optionCount: 3, eligibleCount: 1 }]],
      }) }) }) } }),
      readMemory: async () => { reads++; throw new Error('private Cosmos details'); },
    });
    const result = await handler();
    assert.equal(result.status, 503);
    assert.equal(result.jsonBody.dependency, missing ? 'sql' : 'cosmos');
    assert.equal(reads, missing ? 0 : 1);
    assert.doesNotMatch(JSON.stringify(result), /private Cosmos/);
  }
});

test('readiness rejects expired or unavailable eligibility before reading Cosmos', async () => {
  for (const eligibleCount of [0, null, undefined]) {
    let reads = 0;
    const codes: string[] = [];
    const handler = createStaffingReadiness({ caseId: 'configured-case',
      resources: async () => ({ pool: { request: () => ({ input: () => ({ query: async () => ({
        recordsets: [[{ memoryId: 'source', memoryPartition: 'partition' }], [{ optionCount: 3, eligibleCount }]],
      }) }) }) } }),
      readMemory: async () => { reads++; },
      log: (_event: string, details: { code: string }) => { codes.push(details.code); },
    });
    const result = await handler();
    assert.equal(result.status, 503);
    assert.equal(result.jsonBody.ready, false);
    assert.equal(result.jsonBody.dependency, 'sql');
    assert.equal(reads, 0);
    assert.deepEqual(codes, ['CASE_NO_ELIGIBLE_OPTION']);
    assert.doesNotMatch(JSON.stringify(result), /configured-case|partition|memoryId/);
  }
});