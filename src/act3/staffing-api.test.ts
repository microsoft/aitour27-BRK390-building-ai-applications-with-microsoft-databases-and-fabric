import assert from 'node:assert/strict';
import test from 'node:test';
import {HttpRequest} from '@azure/functions';
import {createStaffingHandler,STAFFING_POLICY_SQL,STAFFING_SNAPSHOT_SQL} from './staffing-api.ts';
import {validateMemoryEvidence, type MemoryEvidence} from './staffing-memory.ts';
import scenario from './staffing-scenario.json' with {type:'json'};

const request=(action:string,method='GET',body?:unknown)=>new HttpRequest({url:'https://example.test/api/staffing/'+action,
  method,params:{action},headers:{'content-type':'application/json'},...(body?{body:{string:JSON.stringify(body)}}:{})});
const context={error(){}};

function assessmentFixture() {
  const events:string[]=[];
  const current={...scenario.case,contextHash:'a'.repeat(64)};
  const state={current,assessed:structuredClone(current),memory:structuredClone(scenario.rehearsalMemory) as MemoryEvidence['memory'],
    options:[{caseId:current.caseId,contextHash:current.contextHash,optionId:'temporary',eligible:true}],
    memoryError:null as Error|null,sqlError:null as Error|null,embeddingError:null as Error|null};
  const actor={objectId:'actor',roles:['ROLE-ACT3-READER','ROLE-OPERATIONS-APPROVER']};
  const evidence=()=>validateMemoryEvidence({memory:state.memory,hash:'',source:'test',etag:'test',mode:'cosmos'},current.memoryId,current.memoryPartition);
  const inputs:Record<string,unknown>={};
  const command={input(name:string,_type:unknown,value:unknown){inputs[name]=value;return this;},
    async query(text:string){
      if(state.sqlError)throw state.sqlError;
      if(text===STAFFING_SNAPSHOT_SQL){events.push('options');return {recordsets:[[state.assessed],state.options,[],[]]};}
      if(text===STAFFING_POLICY_SQL){events.push('policies');return {recordset:[{policyId:'POL-SHIFT-NOTICE',noticeDays:21}]};}
      events.push('case');return {recordset:[state.current]};
    },
    async execute(procedure:string){events.push(procedure);if(state.sqlError)throw state.sqlError;return {recordset:[{state:'proposed'}]};}};
  const handler=createStaffingHandler({caseId:current.caseId,tokenVerifier:{verify:async()=>actor},
    resources:async()=>({pool:{request:()=>command},embedder:{profile:'test',embed:async()=>{
      events.push('embed');if(state.embeddingError)throw state.embeddingError;return [0.1];}}} as any),
    readMemory:async()=>{events.push('memory');if(state.memoryError)throw state.memoryError;
      return {memory:state.memory,hash:'untrusted',source:'test',etag:'test',mode:'cosmos'};}});
  return {handler,state,events,evidence,inputs,actor};
}

test('assessment reads and validates Cosmos before SQL options and policy embedding, returning the UI contract',async()=>{
  const fixture=assessmentFixture();
  const result=await fixture.handler(request('assess','POST',{question:'Can temporary workers cover committed demand?'}),context);
  assert.equal(result.status,200);
  assert.deepEqual(fixture.events,['case','memory','options','embed','policies']);
  const body=result.jsonBody as any;
  assert.deepEqual(Object.keys(body),['snapshot','memory','policies']);
  assert.equal(body.snapshot.contextHash,fixture.state.current.contextHash);
  assert.deepEqual(body.snapshot.actor,fixture.actor);
  assert.deepEqual(body.snapshot.approvals,[]);assert.equal(body.snapshot.plan,null);
  assert.deepEqual(body.snapshot.options,[{caseId:fixture.state.current.caseId,contextHash:fixture.state.current.contextHash,optionId:'temporary',eligible:true}]);
  assert.equal(body.memory.applicable,true);
  assert.equal(body.memory.hash,fixture.evidence().hash);
  assert.deepEqual(body.memory.productivity,{gainPerWorker:0.08,maxExtraWorkers:2});
  assert.equal(body.memory.workforcePriority,scenario.rehearsalMemory.workforcePriority);
  assert.equal(body.policies.question,'Can temporary workers cover committed demand?');
  assert.equal(body.policies.matches[0].noticeDays,21);
});

test('assessment and policy question validation agree and do not touch dependencies',async()=>{
  for(const action of ['assess','policies'])for(const question of [undefined,null,4,'  ','ab','x'.repeat(2001)]){
    const fixture=assessmentFixture();
    assert.equal((await fixture.handler(request(action,'POST',{question}),context)).status,400);
    assert.deepEqual(fixture.events,[]);
  }
  const fixture=assessmentFixture();
  assert.equal((await fixture.handler(request('assess'),context)).status,405);
});

test('missing and old-shaped lessons stop assessment before options or embedding without leaking source errors',async()=>{
  for(const malformed of [true,false]){
    const fixture=assessmentFixture();
    if(malformed)delete (fixture.state.memory as any).productivity;
    else fixture.state.memoryError=new Error('private source URI and credential');
    const logs:unknown[]=[];
    const result=await fixture.handler(request('assess','POST',{question:'Assess staffing'}),{error(...values){logs.push(values);}});
    assert.equal(result.status,503);
    assert.deepEqual(fixture.events,['case','memory']);
    assert.equal((result.jsonBody as any).dependency,'cosmos');
    assert.equal('snapshot' in (result.jsonBody as any),false);
    assert.doesNotMatch(JSON.stringify([result.jsonBody,logs]),/private source URI and credential/);
  }
});

test('line, model and numeric mismatches prevent both assessment and proposal',async()=>{
  for(const change of [{lineId:'another-line'},{modelVersion:'another-model'},
    {productivity:{gainPerWorker:0.09,maxExtraWorkers:2}},{productivity:{gainPerWorker:0.08,maxExtraWorkers:3}}]){
    for(const action of ['assess','propose']){
      const fixture=assessmentFixture();Object.assign(fixture.state.memory,change);
      const result=await fixture.handler(request(action,'POST',{question:'Assess staffing',reviewedHash:'a'.repeat(64),reviewedMemoryHash:fixture.evidence().hash}),context);
      assert.equal(result.status,409);assert.deepEqual(fixture.events,['case','memory']);
      assert.match((result.jsonBody as any).error,/productivity lesson does not match/);
      assert.equal('snapshot' in (result.jsonBody as any),false);
    }
  }
});

test('SQL context changes during assessment prevent returning options and skip policy embedding',async()=>{
  const fixture=assessmentFixture();fixture.state.assessed.contextHash='d'.repeat(64);
  const result=await fixture.handler(request('assess','POST',{question:'Assess staffing'}),context);
  assert.equal(result.status,409);assert.deepEqual(fixture.events,['case','memory','options']);
  assert.equal('snapshot' in (result.jsonBody as any),false);
});

test('assessment rejects every option with mismatched or missing SQL provenance before embedding or policy retrieval',async()=>{
  for(const change of [{contextHash:'d'.repeat(64)},{contextHash:undefined},{contextHash:null},{contextHash:''},
    {caseId:'another-case'},{caseId:undefined},{caseId:null}]){
    for(const optionIndex of [0,1]){
      const fixture=assessmentFixture();
      fixture.state.options.push({...fixture.state.options[0],optionId:'unchanged',eligible:false});
      Object.assign(fixture.state.options[optionIndex],change);
      for(const [field,value] of Object.entries(change))if(value===undefined)Reflect.deleteProperty(fixture.state.options[optionIndex],field);
      const result=await fixture.handler(request('assess','POST',{question:'Assess staffing'}),context);
      assert.equal(result.status,409);
      assert.deepEqual(fixture.events,['case','memory','options']);
      assert.deepEqual(result.jsonBody,{error:'The case changed during assessment. Assess staffing again.'});
    }
  }
});

test('assessment rejects missing option hashes even when both case reads lack a hash',async()=>{
  const fixture=assessmentFixture();
  for(const row of [fixture.state.current,fixture.state.assessed,...fixture.state.options])Reflect.deleteProperty(row,'contextHash');
  const result=await fixture.handler(request('assess','POST',{question:'Assess staffing'}),context);
  assert.equal(result.status,409);
  assert.deepEqual(fixture.events,['case','memory','options']);
  assert.deepEqual(result.jsonBody,{error:'The case changed during assessment. Assess staffing again.'});
});

test('assessment allows an empty SQL options result',async()=>{
  const fixture=assessmentFixture();fixture.state.options=[];
  const result=await fixture.handler(request('assess','POST',{question:'Assess staffing'}),context);
  assert.equal(result.status,200);
  assert.deepEqual(fixture.events,['case','memory','options','embed','policies']);
  assert.deepEqual((result.jsonBody as any).snapshot.options,[]);
});

test('proposal rereads validated Cosmos and binds its canonical hash and the reviewed SQL context to a typed procedure',async()=>{
  const fixture=assessmentFixture();
  const reviewedMemoryHash=fixture.evidence().hash;
  const result=await fixture.handler(request('propose','POST',{reviewedHash:fixture.state.current.contextHash,reviewedMemoryHash}),context);
  assert.equal(result.status,200);assert.deepEqual(fixture.events,['case','memory','staffing.propose']);
  assert.equal(fixture.inputs.reviewedHash,fixture.state.current.contextHash);
  assert.equal(fixture.inputs.memoryHash,reviewedMemoryHash);
  assert.equal(fixture.inputs.memoryLine,fixture.state.current.lineId);
  assert.equal(fixture.inputs.memoryModel,fixture.state.current.modelVersion);
});

test('a changed holiday priority invalidates the reviewed memory hash before proposal',async()=>{
  const fixture=assessmentFixture();const reviewedMemoryHash=fixture.evidence().hash;
  fixture.state.memory.workforcePriority='Protect published vacations and existing line assignments.';
  const result=await fixture.handler(request('propose','POST',{reviewedHash:'a'.repeat(64),reviewedMemoryHash}),context);
  assert.equal(result.status,409);assert.deepEqual(fixture.events,['case','memory']);
});

test('changed numeric lesson hashes cannot reuse a prior source review even when the new SQL model matches',async()=>{
  for(const productivity of [{gainPerWorker:0.09,maxExtraWorkers:2},{gainPerWorker:0.08,maxExtraWorkers:3}]){
    const fixture=assessmentFixture();const reviewedMemoryHash=fixture.evidence().hash;
    fixture.state.memory.productivity=productivity;
    Object.assign(fixture.state.current,productivity);
    assert.notEqual(fixture.evidence().hash,reviewedMemoryHash);
    const result=await fixture.handler(request('propose','POST',{reviewedHash:fixture.state.current.contextHash,reviewedMemoryHash}),context);
    assert.equal(result.status,409);assert.deepEqual(fixture.events,['case','memory']);
    assert.match((result.jsonBody as any).error,/source changed since your review/);
  }
});

test('Cosmos cannot teach or override SQL policy, even when extra policy-shaped fields are present',async()=>{
  const fixture=assessmentFixture();Object.assign(fixture.state.memory,{noticeDays:0,allowNewAssignments:true});
  const result=await fixture.handler(request('assess','POST',{question:'Assess staffing'}),context);
  assert.equal(result.status,200);
  const body=result.jsonBody as any;
  assert.equal('noticeDays' in body.memory.memory,false);
  assert.equal('allowNewAssignments' in body.memory.memory,false);
  assert.equal(body.policies.matches[0].noticeDays,21);
  assert.equal('noticeDays' in fixture.inputs,false);
  assert.equal('gainPerWorker' in fixture.inputs,false);
});

test('dependency failures return no partial recommendation or backend source details',async()=>{
  for(const dependency of ['sqlError','embeddingError'] as const){
    const fixture=assessmentFixture();fixture.state[dependency]=new Error('private backend source detail');
    const logs:unknown[]=[];
    const result=await fixture.handler(request('assess','POST',{question:'Assess staffing'}),{error(...values){logs.push(values);}});
    assert.equal(result.status,503);assert.equal('snapshot' in (result.jsonBody as any),false);
    assert.doesNotMatch(JSON.stringify([result.jsonBody,logs]),/private backend source detail/);
  }
});
test('staffing approval cannot substitute a role supplied in the request for token authorization',async()=>{
  let accessed=false;
  const handler=createStaffingHandler({caseId:'CASE-STAFFING',tokenVerifier:{verify:async()=>({objectId:'actor',roles:['ROLE-ACT3-READER']})},
    resources:async()=>{accessed=true;throw new Error();},readMemory:async()=>{throw new Error();}});
  assert.equal((await handler(request('approve','POST',{approverRole:'ROLE-HR-APPROVER'}),context)).status,403);
  assert.equal(accessed,false);
});
test('missing Cosmos evidence blocks a proposal before any write',async()=>{
  let writes=0;
  const command={input(){return this;},query:async()=>({recordset:[{memoryId:'memory',memoryPartition:'previous',lineId:'PKG-02',modelVersion:'packing-v1'}]}),execute:async()=>{writes++;}};
  const handler=createStaffingHandler({caseId:'CASE-STAFFING',tokenVerifier:{verify:async()=>({objectId:'actor',roles:['ROLE-ACT3-READER','ROLE-OPERATIONS-APPROVER']})},
    resources:async()=>({pool:{request:()=>command},embedder:{}} as any),readMemory:async()=>{throw new Error('403');}});
  const result=await handler(request('propose','POST',{reviewedHash:'a'.repeat(64),reviewedMemoryHash:'b'.repeat(64)}),context);
  assert.equal(result.status,503);
  assert.equal((result.jsonBody as any).dependency,'cosmos');
  assert.equal((result.jsonBody as any).writeOutcomeUnknown,false);
  assert.equal(writes,0);
});
test('policy retrieval combines vector distance with scope, status and full-window validity',()=>{
  for(const expression of ["VECTOR_DISTANCE('cosine'",'policy.factoryId=currentCase.factoryId','policy.lineId IS NULL',"policy.status='approved'",'policy.validUntil>=currentCase.windowEnd','policy.embeddingProfile=@profile']) assert.ok(STAFFING_POLICY_SQL.includes(expression));
});
test('a source changed since browser review cannot be silently adopted by a write',async()=>{
  let writes=0;
  const command={input(){return this;},query:async()=>({recordset:[scenario.case]}),execute:async()=>{writes++;}};
  const handler=createStaffingHandler({caseId:scenario.case.caseId,
    tokenVerifier:{verify:async()=>({objectId:'actor',roles:['ROLE-ACT3-READER','ROLE-OPERATIONS-APPROVER']})},
    resources:async()=>({pool:{request:()=>command},embedder:{}} as any),
    readMemory:async()=>({memory:{...scenario.rehearsalMemory,bottleneck:'end-of-line-packing'},hash:'c'.repeat(64),source:'test',etag:'test',mode:'cosmos'})});
  const result=await handler(request('propose','POST',{reviewedHash:'a'.repeat(64),reviewedMemoryHash:'b'.repeat(64)}),context);
  assert.equal(result.status,409);assert.equal(writes,0);
});