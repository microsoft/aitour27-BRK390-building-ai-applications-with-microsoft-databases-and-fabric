import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpRequest } from '@azure/functions';
import { createReviewHandler, SNAPSHOT_SQL, REVIEW_PROCEDURES } from './review-api.ts';
import { GUIDANCE_SEARCH_SQL } from './guidance-adapters.ts';

const actorId = '00000000-0000-0000-0000-000000000123';
const context = { error() {} };
const makeRequest = (action: string, body?: unknown) => new HttpRequest({
  url:`https://example.test/api/review/${action}`,method:['snapshot', 'retrieval-contract'].includes(action) ? 'GET' : 'POST',params:{action},
  headers:{authorization:'Bearer test','content-type':'application/json'},...(body ? {body:{string:JSON.stringify(body)}} : {}),
});
const approval = {requestId:'00000000-0000-0000-0000-000000000456',caseId:'CASE-2026-HS-001',optionId:'OPT-4',reviewedHash:'a'.repeat(64),approverRole:'ROLE-OPERATIONS-APPROVER'};

test('retrieval SQL contract is reader-protected and identical to the executing adapter', async () => {
  const resources = async (): Promise<any> => { throw new Error('No database call expected'); };
  const handler = (roles: string[]) => createReviewHandler({
    tokenVerifier: { verify: async () => ({ objectId: actorId, roles }) }, resources,
  });
  assert.equal((await handler([])(makeRequest('retrieval-contract'), context)).status, 403);
  const result = await handler(['ROLE-ACT3-READER'])(makeRequest('retrieval-contract'), context);
  assert.equal(result.status, 200);
  assert.equal((result.jsonBody as { sql: string }).sql, GUIDANCE_SEARCH_SQL);
  const operations = (result.jsonBody as { operations: Record<string, { sql?: string; procedure?: string }> }).operations;
  assert.equal(operations['review/snapshot'].sql, SNAPSHOT_SQL);
  assert.equal(operations['act3/guidance'].sql, GUIDANCE_SEARCH_SQL);
  for (const action of ['approve', 'draft', 'publish'] as const) {
    assert.equal(operations[`review/${action}`].procedure, REVIEW_PROCEDURES[action]);
  }
});

test('review endpoints reject invalid identity and missing reader/reviewer roles before SQL',async () => {
  let calls=0;
  const resources=async (): Promise<any> => {calls++; throw new Error('Unexpected database access');};
  const invalid=createReviewHandler({tokenVerifier:{verify:async()=>{throw new Error('Invalid token');}},resources});
  assert.equal((await invalid(makeRequest('snapshot'),context)).status,401);
  const reader=createReviewHandler({tokenVerifier:{verify:async()=>({objectId:actorId,roles:['ROLE-ACT3-READER']})},resources});
  assert.equal((await reader(makeRequest('approve',approval),context)).status,403);
  assert.equal((await reader(makeRequest('publish',{}),context)).status,403);
  assert.equal((await reader(makeRequest('draft',{}),context)).status,403);
  const noReader=createReviewHandler({tokenVerifier:{verify:async()=>({objectId:actorId,roles:['ROLE-ACT3-REVIEWER']})},resources});
  assert.equal((await noReader(makeRequest('snapshot'),context)).status,403);
  assert.equal(calls,0);
});

test('approvals bind the token actor and role to the reviewed option and SQL procedure',async () => {
  const inputs:Record<string,unknown>={}; let procedure='';
  const query={input(name:string,_type:unknown,value:unknown){inputs[name]=value;return this;},async execute(name:string){procedure=name;return {recordset:[{requestId:approval.requestId}]};}};
  const handler=createReviewHandler({tokenVerifier:{verify:async()=>({objectId:actorId,roles:['ROLE-ACT3-READER','ROLE-OPERATIONS-APPROVER']})},resources:async()=>({pool:{request:()=>query} as any,embedder:{} as any})});
  const result=await handler(makeRequest('approve',{...approval,actorId:'untrusted'}),context);
  assert.equal(result.status,200); assert.equal(inputs.actorId,actorId); assert.equal(inputs.reviewedHash,approval.reviewedHash);
  assert.equal(inputs.optionId,'OPT-4'); assert.equal(procedure,'act3.approve_option');
  assert.equal((await handler(makeRequest('approve',{...approval,approverRole:'ROLE-MAINTENANCE-APPROVER'}),context)).status,403);
});

test('SQL stale-state failures return conflict; infrastructure failures stay private',async () => {
  const handler=(failure:unknown)=>createReviewHandler({tokenVerifier:{verify:async()=>({objectId:actorId,roles:['ROLE-ACT3-READER']})},resources:async()=>{throw failure;}});
  assert.equal((await handler({number:51002,message:'Refresh before approving.'})(makeRequest('snapshot'),context)).status,409);
  const failed=await handler(new Error('private connection details'))(makeRequest('snapshot'),context);
  assert.equal(failed.status,503); assert.ok(!JSON.stringify(failed).includes('private connection details'));
});

test('an approval connection failure reports an unknown outcome and does not replay it', async () => {
  let executions = 0;
  const query = { input() { return this; }, async execute() { executions++; throw { code: 'ETIMEOUT' }; } };
  const handler = createReviewHandler({ tokenVerifier: { verify: async () => ({ objectId: actorId,
    roles: ['ROLE-ACT3-READER', 'ROLE-OPERATIONS-APPROVER'] }) },
    resources: async () => ({ pool: { request: () => query } as any, embedder: {} as any }) });
  const result = await handler(makeRequest('approve', approval), context);
  assert.equal(result.status, 503);
  assert.match((result.jsonBody as { error: string }).error, /outcome is unknown/);
  assert.equal(executions, 1);
});