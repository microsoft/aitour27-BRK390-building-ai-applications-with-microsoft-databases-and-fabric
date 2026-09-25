import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import sql from 'mssql';
import { SqlGuidanceStore } from '../../src/act3/guidance-adapters.ts';
import { config, connect } from './staffing-admin.mjs';
const pool = await connect();
const actor = '00000000-0000-0000-0000-000000000123';
const results = [];
async function test(name, callback) {
  const transaction = new sql.Transaction(pool);
  let rolledBack = false;
  transaction.on('rollback', () => { rolledBack = true; });
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const request = () => new sql.Request(transaction);
  const caseId = `TEST-${randomUUID()}`;
  try {
    await request().input('caseId',sql.NVarChar(100),caseId).query(`INSERT dbo.decision_cases(caseId,lineId,payload,sourceHash)
      SELECT TOP(1) @caseId,lineId,payload,sourceHash FROM dbo.decision_cases WHERE caseId NOT LIKE 'TEST-%' ORDER BY importedAt DESC;`);
    const state = async () => (await request().input('caseId',sql.NVarChar(100),caseId).query('SELECT * FROM act3.review_state WHERE caseId=@caseId')).recordset[0];
    const approve = async (role, optionId, hash, requestId=randomUUID()) => (await request()
      .input('requestId',sql.UniqueIdentifier,requestId).input('caseId',sql.NVarChar(100),caseId).input('optionId',sql.NVarChar(100),optionId)
      .input('actorId',sql.UniqueIdentifier,actor).input('approverRole',sql.VarChar(100),role).input('reviewedHash',sql.Char(64),hash)
      .execute('act3.approve_option')).recordset[0];
    await callback({request,caseId,state,approve});
    results.push({name,result:'PASS'}); console.log(`PASS: ${name}`);
  } finally { if (!rolledBack) await transaction.rollback(); }
}
try {
  await test('Role approvals, idempotent receipts and published-only scoped retrieval',async ({request,caseId,state,approve}) => {
    const initial=await state(), requestId=randomUUID();
    const first=await approve('ROLE-OPERATIONS-APPROVER','OPT-4',initial.reviewHash,requestId);
    const retry=await approve('ROLE-OPERATIONS-APPROVER','OPT-4',initial.reviewHash,requestId);
    assert.equal(first.requestId,retry.requestId);
    const secondState=await state(); assert.notEqual(initial.reviewHash,secondState.reviewHash);
    await approve('ROLE-MAINTENANCE-APPROVER','OPT-4',secondState.reviewHash);
    assert.equal((await state()).state,'authorized');
    const plans=await request().input('caseId',sql.NVarChar(100),caseId).query('SELECT * FROM act3.plans WHERE caseId=@caseId');
    assert.equal(plans.recordset.length,1); assert.equal(plans.recordset[0].optionId,'OPT-4');
    const guidanceId=randomUUID();
    const vector=(await request().query('SELECT TOP(1) CAST(embedding AS nvarchar(max)) embedding FROM act3.guidance')).recordset[0].embedding;
    const draft=(await request().input('guidanceId',sql.NVarChar(100),guidanceId).input('caseId',sql.NVarChar(100),caseId)
      .input('title',sql.NVarChar(300),'Transaction verification lesson').input('excerpt',sql.NVarChar(4000),'Database workflow test only; this entire transaction is rolled back.')
      .input('embedding',sql.NVarChar(sql.MAX),vector).input('profile',sql.NVarChar(200),config.embeddingProfile)
      .input('actorId',sql.UniqueIdentifier,actor).execute('act3.draft_guidance')).recordset[0];
    assert.equal(draft.status,'draft');
    const store=new SqlGuidanceStore({request},2);
    const context={caseId,lineId:initial.lineId};
    const search=()=>store.search(context,JSON.parse(vector),config.embeddingProfile);
    assert.ok(!(await search()).some(match=>match.guidanceId===guidanceId));
    const published=(await request().input('guidanceId',sql.NVarChar(100),guidanceId).input('sourceHash',sql.Char(64),draft.sourceHash)
      .input('actorId',sql.UniqueIdentifier,actor).execute('act3.publish_guidance')).recordset[0];
    assert.equal(published.status,'approved'); assert.equal(published.approvedBy.toLowerCase(),actor);
    assert.ok((await search()).some(match=>match.guidanceId===guidanceId));
    assert.equal((await store.search({...context,lineId:'TEST-WRONG-LINE'},JSON.parse(vector),config.embeddingProfile)).length,0);
    assert.equal((await store.search(context,JSON.parse(vector),'TEST-WRONG-PROFILE')).length,0);
    await request().input('id',sql.NVarChar(100),guidanceId).query("UPDATE act3.guidance SET validFrom=DATEADD(day,-2,SYSUTCDATETIME()),validUntil=DATEADD(day,-1,SYSUTCDATETIME()) WHERE guidanceId=@id");
    assert.ok(!(await search()).some(match=>match.guidanceId===guidanceId));
  });
  await test('Stale reviewed state is rejected',async ({state,approve}) => {
    const initial=await state(); await approve('ROLE-OPERATIONS-APPROVER','OPT-4',initial.reviewHash);
    await assert.rejects(approve('ROLE-MAINTENANCE-APPROVER','OPT-4',initial.reviewHash),error=>error.number===51002);
  });
  await test('Full-rate maintenance deferral fails current policy',async ({state,approve}) => {
    await assert.rejects(approve('ROLE-OPERATIONS-APPROVER','OPT-3',(await state()).reviewHash),error=>error.number===51005);
  });
  await test('Policy changes invalidate an existing review hash',async ({request,state,approve}) => {
    const initial=await state(); await request().query("UPDATE dbo.approved_policies SET status='withdrawn' WHERE policyId='POL-MAINT-002'");
    await assert.rejects(approve('ROLE-OPERATIONS-APPROVER','OPT-4',initial.reviewHash),error=>error.number===51002);
  });
  await test('Refreshing after a policy change cannot reuse a prior role approval',async ({request,state,approve}) => {
    await approve('ROLE-OPERATIONS-APPROVER','OPT-4',(await state()).reviewHash);
    await request().query("UPDATE dbo.approved_policies SET ruleJson=JSON_MODIFY(ruleJson,'$.stressCeilingPct',116) WHERE policyId='POL-MAINT-002'");
    await assert.rejects(approve('ROLE-MAINTENANCE-APPROVER','OPT-4',(await state()).reviewHash),error=>error.number===51002);
  });
  await test('The daily embedding budget rejects request 201',async ({request}) => {
    await request().query("IF NOT EXISTS(SELECT 1 FROM act3.embedding_budget WHERE day=CONVERT(date,SYSUTCDATETIME())) INSERT act3.embedding_budget VALUES(CONVERT(date,SYSUTCDATETIME()),0); UPDATE act3.embedding_budget SET requests=199 WHERE day=CONVERT(date,SYSUTCDATETIME());");
    await request().execute('act3.consume_embedding_budget');
    await assert.rejects(request().execute('act3.consume_embedding_budget'),error=>error.number===51010);
  });
  const retained=await pool.request().query("SELECT COUNT(*) count FROM dbo.decision_cases WHERE caseId LIKE 'TEST-%'; SELECT COUNT(*) count FROM act3.approvals; SELECT COUNT(*) count FROM act3.plans;");
  assert.equal(retained.recordsets[0][0].count,0);
  mkdirSync(new URL('../../build/evidence/',import.meta.url), { recursive: true });
  writeFileSync(new URL('../../build/evidence/sql-verification.json',import.meta.url),JSON.stringify({verifiedAt:new Date().toISOString(),database:config.sqlDatabase,results,retainedTestCases:0,approvalCount:retained.recordsets[1][0].count,planCount:retained.recordsets[2][0].count},null,2)+'\n');
} finally { await pool.close(); }