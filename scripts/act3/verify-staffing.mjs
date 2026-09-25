import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sql from 'mssql';
import {connect,insertCase,scenario} from './staffing-admin.mjs';

const pool=await connect();
const results=[];
async function verify(name,check){
  const transaction=new sql.Transaction(pool);
  let rolledBack=false;
  transaction.on('rollback',()=>{rolledBack=true;});
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const caseId=`TEST-STAFF-${randomUUID()}`;
  const request=()=>new sql.Request(transaction);
  const actorId='00000000-0000-4000-8000-000000000001';
  try{
    await insertCase({request},caseId);
    const snapshot=async()=>(await request().input('caseId',sql.NVarChar(100),caseId).query('SELECT * FROM staffing.current_cases WHERE caseId=@caseId')).recordset[0];
    const propose=async(reviewedHash)=>(await request().input('caseId',sql.NVarChar(100),caseId).input('reviewedHash',sql.Char(64),reviewedHash)
      .input('memoryHash',sql.Char(64),'b'.repeat(64)).input('memorySource',sql.NVarChar(1000),'rollback-test')
      .input('memoryLine',sql.NVarChar(100),scenario.case.lineId).input('memoryModel',sql.NVarChar(100),scenario.case.modelVersion).execute('staffing.propose')).recordset[0];
    const approve=async(role,reviewedHash,requestId=randomUUID())=>(await request().input('caseId',sql.NVarChar(100),caseId)
      .input('requestId',sql.UniqueIdentifier,requestId).input('actorId',sql.UniqueIdentifier,actorId).input('approverRole',sql.VarChar(100),role)
      .input('reviewedHash',sql.Char(64),reviewedHash).input('memoryHash',sql.Char(64),'b'.repeat(64)).execute('staffing.approve')).recordset[0];
    await check({request,caseId,snapshot,propose,approve});
    results.push({name,passed:true});
  }finally{if(!rolledBack)await transaction.rollback();}
}
try{
  await verify('seeding rejects changed existing facts without overwriting them',async({request,caseId})=>{
    await insertCase({request},caseId);
    await request().input('caseId',sql.NVarChar(100),caseId).query('UPDATE staffing.cases SET demandUnits=demandUnits+1 WHERE caseId=@caseId');
    await assert.rejects(()=>insertCase({request},caseId),/differs at demandUnits/);
    const stored=(await request().input('caseId',sql.NVarChar(100),caseId).query('SELECT demandUnits FROM staffing.cases WHERE caseId=@caseId')).recordset[0];
    assert.equal(stored.demandUnits,scenario.case.demandUnits+1);
  });
  await verify('SQL calculates the shortfall and both staffing options',async({request,caseId})=>{
    const rows=(await request().input('caseId',sql.NVarChar(100),caseId).query('SELECT * FROM staffing.options(@caseId)')).recordset;
    assert.equal(rows.find(row=>row.optionId==='unchanged').shortfallUnits,scenario.expected.shortfallUnits);
    assert.equal(rows.find(row=>row.optionId==='unchanged').outputUnits,scenario.expected.baselineUnits);
    assert.equal(rows.find(row=>row.optionId==='reassign').eligible,false);
    assert.match(rows.find(row=>row.optionId==='reassign').reason,/notice/);
    assert.equal(rows.find(row=>row.optionId==='temporary').outputUnits,scenario.expected.staffedUnits);
    assert.equal(rows.find(row=>row.optionId==='temporary').eligible,true);
  });
  await verify('two roles authorize one plan; duplicate request returns its receipt',async({request,caseId,snapshot,propose,approve})=>{
    const current=await snapshot();await propose(current.contextHash);
    const requestId=randomUUID();await approve('ROLE-OPERATIONS-APPROVER',current.contextHash,requestId);
    assert.equal((await snapshot()).state,'awaiting_approval');
    await approve('ROLE-OPERATIONS-APPROVER',current.contextHash,requestId);
    await approve('ROLE-HR-APPROVER',current.contextHash);
    assert.equal((await snapshot()).state,'authorized');
    assert.equal((await request().input('caseId',sql.NVarChar(100),caseId).query('SELECT COUNT(*) AS count FROM staffing.plans WHERE caseId=@caseId')).recordset[0].count,1);
  });
  await verify('changing policy after first approval invalidates the proposal',async({request,snapshot,propose,approve})=>{
    const current=await snapshot();await propose(current.contextHash);await approve('ROLE-OPERATIONS-APPROVER',current.contextHash);
    await request().query("UPDATE staffing.policies SET allowNewAssignments=0 WHERE policyId='POL-TEMP-PACKING'");
    await assert.rejects(()=>approve('ROLE-HR-APPROVER',current.contextHash),error=>error.number===51106);
  });
  await verify('changing the operating calendar invalidates the reviewed proposal',async({request,caseId,snapshot,propose,approve})=>{
    const current=await snapshot();await propose(current.contextHash);await approve('ROLE-OPERATIONS-APPROVER',current.contextHash);
    const revised=JSON.parse(current.operatingDates).slice(1);
    await request().input('caseId',sql.NVarChar(100),caseId).input('calendar',sql.NVarChar(sql.MAX),JSON.stringify(revised))
      .query('UPDATE staffing.cases SET operatingDates=@calendar WHERE caseId=@caseId');
    assert.notEqual((await snapshot()).contextHash,current.contextHash);
    await assert.rejects(()=>approve('ROLE-HR-APPROVER',current.contextHash),error=>error.number===51106);
  });
  await verify('changing dataset provenance invalidates the reviewed proposal',async({request,caseId,snapshot,propose,approve})=>{
    const current=await snapshot();await propose(current.contextHash);await approve('ROLE-OPERATIONS-APPROVER',current.contextHash);
    await request().input('caseId',sql.NVarChar(100),caseId)
      .query("UPDATE staffing.cases SET datasetContext=JSON_MODIFY(datasetContext,'$.sourceHash','changed-source') WHERE caseId=@caseId");
    await assert.rejects(()=>approve('ROLE-HR-APPROVER',current.contextHash),error=>error.number===51106);
  });
  await verify('mandatory policy is enforced independently of vector ranking',async({request,caseId,snapshot,propose})=>{
    await request().query("UPDATE staffing.policies SET status='withdrawn' WHERE policyId='POL-SHIFT-NOTICE'");
    const current=await snapshot();
    await assert.rejects(()=>propose(current.contextHash),error=>error.number===51103);
  });
  await verify('onboarding readiness is enforced',async({request,caseId,snapshot,propose})=>{
    await request().input('caseId',sql.NVarChar(100),caseId).query('UPDATE staffing.cases SET qualified=0 WHERE caseId=@caseId');
    await assert.rejects(()=>snapshot().then(current=>propose(current.contextHash)),error=>error.number===51103);
  });
  await verify('expired authorized case and receipts survive a fresh compliant isolated case',async({request,caseId,snapshot,propose,approve})=>{
    const current=await snapshot();await propose(current.contextHash);
    await approve('ROLE-OPERATIONS-APPROVER',current.contextHash);
    await approve('ROLE-HR-APPROVER',current.contextHash);
    await request().input('caseId',sql.NVarChar(100),caseId)
      .query('UPDATE staffing.cases SET clockStartedAt=DATEADD(day,-4,clockStartedAt) WHERE caseId=@caseId');
    const retained=async()=>(await request().input('caseId',sql.NVarChar(100),caseId).query(`
      SELECT * FROM staffing.cases WHERE caseId=@caseId;
      SELECT * FROM staffing.approvals WHERE caseId=@caseId ORDER BY approverRole;
      SELECT * FROM staffing.plans WHERE caseId=@caseId;`)).recordsets;
    const before=await retained();
    assert.equal(before[0][0].state,'authorized');
    assert.equal(before[1].length,2);
    assert.equal(before[2].length,1);
    const expired=(await request().input('caseId',sql.NVarChar(100),caseId)
      .query('SELECT * FROM staffing.options(@caseId)')).recordset;
    assert.ok(expired.every(option=>option.eligible===false));
    assert.match(expired.find(option=>option.optionId==='temporary').reason,/production window has started/);
    const freshId=`TEST-STAFF-${randomUUID()}`;
    await insertCase({request},freshId);
    const fresh=(await request().input('caseId',sql.NVarChar(100),freshId)
      .query('SELECT * FROM staffing.current_cases WHERE caseId=@caseId; SELECT * FROM staffing.options(@caseId);')).recordsets;
    assert.equal(fresh[0][0].state,'review');
    assert.ok(fresh[0][0].planningNow<fresh[0][0].windowStart);
    assert.equal(fresh[1].find(option=>option.optionId==='temporary').eligible,true);
    assert.equal(fresh[1].find(option=>option.optionId==='unchanged').eligible,false);
    assert.match(fresh[1].find(option=>option.optionId==='reassign').reason,/notice period/);
    assert.equal(fresh[1].find(option=>option.optionId==='reassign').requiredNoticeDays,21);
    assert.deepEqual(await retained(),before);
  });
  await verify('clock advancement is rechecked at the second approval',async({request,caseId,snapshot,propose,approve})=>{
    const current=await snapshot();await propose(current.contextHash);await approve('ROLE-OPERATIONS-APPROVER',current.contextHash);
    await request().input('caseId',sql.NVarChar(100),caseId).query('UPDATE staffing.cases SET clockStartedAt=DATEADD(day,-4,clockStartedAt) WHERE caseId=@caseId');
    await assert.rejects(()=>approve('ROLE-HR-APPROVER',current.contextHash),error=>[51106,51108].includes(error.number));
  });
  const retained=(await pool.request().query("SELECT COUNT(*) AS count FROM staffing.cases WHERE caseId LIKE 'TEST-STAFF-%'")).recordset[0].count;
  assert.equal(retained,0);
  console.log(JSON.stringify({results,retainedTestCases:retained},null,2));
}finally{await pool.close();}