import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('./web/staffing.js',import.meta.url),'utf8');
const html=readFileSync(new URL('./web/staffing.html',import.meta.url),'utf8');
const snapshot=()=>({
  contextHash:'context-one',caseId:'case-test',lineId:'line-test',factoryId:'factory-test',
  state:'review',actor:{roles:['ROLE-OPERATIONS-APPROVER']},approvals:[],plan:null,
  planningNow:'2026-09-01T09:00:00Z',windowStart:'2026-09-02T09:00:00Z',windowEnd:'2026-09-12T09:00:00Z',
  onboardingReadyAt:'2026-09-01T09:00:00Z',qualified:true,temporaryAvailable:4,extraWorkers:2,
  demandUnits:12000,dailyOutput:1000,machineDailyLimit:1500,gainPerWorker:.1,maxExtraWorkers:4,
  datasetContext:JSON.stringify({productName:'Test product',productId:'product-test',sourceCaseId:'prior-test',sourceHash:'dataset-hash'}),
  operatingDates:JSON.stringify(['2026-09-02']),
  options:[
    {optionId:'unchanged',optionName:'Current staffing',addedWorkers:0,outputUnits:10000,shortfallUnits:2000,eligible:false,reason:'Capacity shortfall'},
    {optionId:'temporary',optionName:'Temporary packers',addedWorkers:2,outputUnits:12000,shortfallUnits:0,eligible:true,reason:'Checks passed'},
    {optionId:'reassign',optionName:'Reassign existing staff',addedWorkers:2,outputUnits:12000,shortfallUnits:0,eligible:false,reason:'Published shifts require 21 days of notice.'},
  ],
});
const retainedDecision=()=>({
  applicable:true,hash:'memory-hash',mode:'cosmos',source:'Retained decision source',
  finding:'Packing constrained output.',priorAction:'Reassigned colleagues to packing.',
  productivity:{gainPerWorker:.08,maxExtraWorkers:2},workforcePriority:'Protect colleague vacations during December summer holidays.',
  memory:{author:'Karin Blair',recordedAt:'2026-08-01T09:00:00Z',caseId:'prior-test'},
});
const policyMatches=()=>({matches:[{title:'Shift notice',body:'Published shifts require notice.',policyId:'policy-test',policyVersion:'1',lineId:'line-test',distance:.1}]});

async function browser(){
  const elements=new Map();
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){
    assert.ok(!elements.has(match[1]),`Duplicate ID: ${match[1]}`);
    elements.set(match[1],{
      innerHTML:'',textContent:'',value:'',hidden:/\bhidden\b/.test(match[0]),disabled:/\bdisabled\b/.test(match[0]),
      style:{},attributes:{},listeners:{},open:false,
      setAttribute(name,value){this.attributes[name]=value;},
      removeAttribute(name){delete this.attributes[name];},
      addEventListener(name,callback){this.listeners[name]=callback;},
      focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;},
      showModal(){this.open=true;},close(){this.open=false;},
    });
  }
  const element=id=>{assert.ok(elements.has(id),`Missing DOM element: ${id}`);return elements.get(id);};
  element('question').value='How can we cover committed demand?';
  const responses=new Map([
    ['/api/config',{rehearsal:true}],
    ['/api/staffing/snapshot',snapshot()],
    ['/api/staffing/memory',retainedDecision()],
    ['/api/staffing/policies',policyMatches()],
  ]);
  responses.set('/api/staffing/assess',async()=>{
    const values=[];
    for(const endpoint of ['snapshot','memory','policies']){
      const response=responses.get(`/api/staffing/${endpoint}`);
      const value=typeof response==='function'?await response():response;
      if(value?.error)return value;
      values.push(value);
    }
    return {snapshot:values[0],memory:values[1],policies:values[2]};
  });
  const calls=[];
  const storage=new Map();
  const context=vm.createContext({
    setTimeout,clearTimeout,AbortController,crypto:{randomUUID},location:{hostname:'localhost'},
    sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document:{getElementById:element,addEventListener(){},querySelectorAll:()=>[],body:{classList:{add(){},remove(){}}}},
    lucide:{createIcons(){}},msal:{InteractionRequiredAuthError:class extends Error{}},
    fetch:async(url,options)=>{
      calls.push({url,options});
      const response=responses.get(url);
      const body=typeof response==='function'?await response():response;
      if(typeof body?.json==='function')return body;
      return {ok:Boolean(body)&&!body.error,status:body?.status??(body?.error?503:200),json:async()=>body??{error:'Unavailable'}};
    },
  });
  const run=code=>vm.runInContext(code,context);
  await run(source);
  assert.equal(element('message').textContent,'');
  return {element,run,responses,calls,storage};
}

test('initial dashboard contains current records, no assessment results or write requests',async()=>{
  const app=await browser();
  assert.equal(app.element('signedin').hidden,false);
  assert.equal(app.element('assessment-results').hidden,true);
  assert.equal(app.element('decision').hidden,true);
  assert.equal(app.element('options').innerHTML,'');
  assert.match(app.element('metrics').innerHTML,/Committed demand/);
  assert.match(app.element('metrics').innerHTML,/Daily baseline/);
  assert.doesNotMatch(app.element('metrics').innerHTML,/Shortfall|Projected/);
  assert.match(app.element('metrics').innerHTML,/metric-shortfall/);
  assert.equal(app.element('demand-warning').hidden,false);
  assert.equal(app.element('shortfall-label').textContent,'2,000 units short of committed demand');
  assert.equal(app.element('shortfall-detail').textContent,'Current staffing covers 10,000 of 12,000 units in the production window.');
  assert.equal(app.element('propose').disabled,true);
  assert.deepEqual(app.calls.map(call=>call.url),['/api/config','/api/staffing/snapshot']);
  assert.doesNotMatch(html+source,/FOUR MONTHS LATER|SOUTHERN SUMMER|SOUTHERN HEMISPHERE|Karin's production question|Scenario planning clock/);
  assert.match(html,/<details><summary>Calculation details<\/summary>/);
  assert.match(html,/<details id="policy-query" hidden>/);
});

test('demand warning follows the SQL baseline and clears when covered or unavailable',async()=>{
  const app=await browser();
  for(const shortfallUnits of [750,0,undefined]){
    const updated=snapshot();
    if(shortfallUnits===undefined)updated.options=updated.options.filter(option=>option.optionId!=='unchanged');
    else Object.assign(updated.options[0],{shortfallUnits,outputUnits:updated.demandUnits-shortfallUnits});
    app.responses.set('/api/staffing/snapshot',updated);
    await app.run('work(refresh)');
    assert.equal(app.element('demand-warning').hidden,shortfallUnits!==750);
    assert.equal(app.element('metrics').innerHTML.includes('metric-shortfall'),shortfallUnits===750);
    assert.equal(app.element('shortfall-label').textContent,shortfallUnits===750?'750 units short of committed demand':'');
  }
});

test('assessment renders separate capacity, policy and retained decision results with provenance',async()=>{
  const app=await browser();
  await app.run('work(assess)');
  assert.equal(app.element('assessment-results').hidden,false);
  assert.equal(app.element('capacity-results').hidden,false);
  assert.match(app.element('options').innerHTML,/12,000/);
  assert.match(app.element('policy-results').innerHTML,/Shift notice/);
  assert.doesNotMatch(app.element('options').innerHTML,/Shift notice/);
  assert.equal(app.element('memory-origin').textContent,'Azure Cosmos DB');
  assert.match(app.element('source-details').textContent,/Retained decision source.*prior-test/);
  assert.equal(app.element('assessed-question').textContent,app.element('question').value);
  assert.equal(app.element('analysis-state').textContent,'Assessment complete.');
  assert.equal(app.element('propose').disabled,false);
  assert.equal(app.element('approve-operations').disabled,true);
  assert.equal(app.element('result-option').textContent,'Temporary packers');
  assert.equal(app.element('result-output').textContent,'12,000 units projected');
  assert.equal(app.element('result-coverage').textContent,'Demand covered: 12,000 units');
  assert.equal(app.element('result-reason').textContent,'Checks passed');
  assert.equal(app.element('lesson-action').textContent,retainedDecision().priorAction);
  assert.equal(app.element('lesson-finding').textContent,retainedDecision().finding);
  assert.equal(app.element('lesson-productivity').textContent,'8% throughput gain per added packer, up to 2 packers.');
  assert.equal(app.element('lesson-origin').textContent,'Azure Cosmos DB');
  assert.equal(app.element('current-option').textContent,'Reassign existing staff');
  assert.equal(app.element('current-eligibility').textContent,'Blocked');
  assert.equal(app.element('current-eligibility').className,'status blocked');
  assert.equal(app.element('constraint-card').className,'constraint-blocked');
  assert.equal(app.element('current-constraint').textContent,'Published shifts require 21 days of notice.');
  assert.equal(app.element('workforce-priority').textContent,retainedDecision().workforcePriority);
  assert.deepEqual(app.calls.map(call=>call.url),['/api/config','/api/staffing/snapshot','/api/staffing/assess']);
  assert.equal(app.run("results.get('snapshot').origin"),'/api/staffing/assess');
  assert.equal(app.run("results.get('snapshot').resultPath"),'snapshot');
  assert.equal(app.run("results.get('snapshot').result.contextHash"),'context-one');
  assert.equal(app.element('assessment-results').focused,true);
  assert.equal(app.element('assessment-results').scrolled,true);
  assert.match(html,/<section id="option-comparison"/);
  assert.doesNotMatch(app.element('options').innerHTML,/<details|<summary/);
  assert.doesNotMatch(html,/Decision details/);
  assert.equal(app.calls.filter(call=>/\/(propose|approve)$/.test(call.url)).length,0);
});

test('reassignment status styling follows SQL eligibility and clears when unavailable',async()=>{
  const app=await browser();
  for(const eligible of [false,true,undefined,false]){
    const updated=snapshot();
    if(eligible===undefined)updated.options=updated.options.filter(option=>option.optionId!=='reassign');
    else updated.options.find(option=>option.optionId==='reassign').eligible=eligible;
    app.responses.set('/api/staffing/snapshot',updated);
    await app.run('work(assess)');
    assert.equal(app.element('current-eligibility').textContent,eligible===undefined?'Unavailable':eligible?'Eligible':'Blocked');
    assert.equal(app.element('current-eligibility').className,eligible===undefined?'status unavailable':eligible?'status':'status blocked');
    assert.equal(app.element('constraint-card').className,eligible===false?'constraint-blocked':'');
  }
});

test('a new assessment immediately clears old results, disables writes, and captures the submitted question',async()=>{
  const app=await browser();
  await app.run('work(assess)');
  const pending=Promise.withResolvers();
  const started=Promise.withResolvers();
  app.responses.set('/api/staffing/policies',()=>{started.resolve();return pending.promise;});
  app.element('question').value='Submitted question';
  const assessment=app.run('work(assess)');
  await started.promise;
  app.element('question').value='Unsubmitted edit';
  assert.equal(app.element('assessment-results').attributes['aria-busy'],'true');
  assert.equal(app.element('capacity-results').hidden,true);
  assert.equal(app.element('policy-results').innerHTML,'');
  assert.equal(app.element('memory-finding').textContent,'');
  assert.equal(app.element('source-details').textContent,'Not assessed.');
  assert.match(app.element('policy-state').textContent,/Retrieving/);
  assert.equal(app.element('propose').disabled,true);
  assert.equal(app.element('assess').disabled,true);
  pending.resolve(policyMatches());
  await assessment;
  assert.equal(app.element('assessment-results').attributes['aria-busy'],'false');
  assert.equal(app.element('assessed-question').textContent,'Submitted question');
  assert.equal(JSON.parse(app.calls.filter(call=>call.url.endsWith('/assess')).at(-1).options.body).question,'Submitted question');
});

test('retry failures cannot leave stale policy or memory results and block missing-source approval',async()=>{
  const app=await browser();
  await app.run('work(assess)');
  app.responses.set('/api/staffing/policies',{error:'Policy service unavailable'});
  app.responses.set('/api/staffing/memory',{error:'Decision service unavailable'});
  await app.run('work(assess)');
  assert.equal(app.element('policy-results').innerHTML,'');
  assert.equal(app.element('policy-query').hidden,true);
  assert.equal(app.element('memory-results').hidden,true);
  assert.equal(app.element('capacity-results').hidden,true);
  assert.equal(app.element('assessment-results').hidden,true);
  assert.equal(app.element('conclusion').hidden,true);
  assert.equal(app.element('result-option').textContent,'');
  assert.equal(app.element('lesson-action').textContent,'');
  assert.equal(app.element('lesson-productivity').textContent,'');
  assert.equal(app.element('current-constraint').textContent,'');
  assert.match(app.element('message').textContent,/Decision service unavailable/);
  assert.equal(app.element('analysis-state').textContent,'Assessment failed. Retry assessment.');
  assert.equal(app.element('propose').disabled,true);
  assert.equal(app.run("results.has('policies')"),false);
  assert.equal(app.run("results.has('memory')"),false);
  assert.equal(app.run("results.has('assess')"),false);
});

test('snapshot failure stops retrieval and exposes an explicit assessment error',async()=>{
  const app=await browser();
  await app.run('work(assess)');
  app.responses.set('/api/staffing/snapshot',{error:'SQL unavailable'});
  const callsBefore=app.calls.length;
  await app.run('work(assess)');
  assert.deepEqual(app.calls.slice(callsBefore).map(call=>call.url),['/api/staffing/assess']);
  assert.match(app.element('message').textContent,/SQL unavailable/);
  assert.equal(app.element('capacity-results').hidden,true);
  assert.equal(app.element('decision').hidden,true);
  assert.equal(app.element('propose').disabled,true);
  assert.equal(app.element('analysis-state').textContent,'Assessment failed. Retry assessment.');
  assert.equal(app.element('assessment-results').attributes['aria-busy'],'false');
});

test('empty policy matches remain explicit and nonapplicable decisions fail closed',async()=>{
  const app=await browser();
  app.responses.set('/api/staffing/policies',{matches:[]});
  await app.run('work(assess)');
  assert.match(app.element('policy-state').textContent,/No policies matched/);
  assert.equal(app.element('policy-query').hidden,false);
  app.responses.set('/api/staffing/memory',{...retainedDecision(),applicable:false});
  await app.run('work(assess)');
  assert.equal(app.element('assessment-results').hidden,true);
  assert.match(app.element('message').textContent,/incomplete/);
  assert.equal(app.element('propose').disabled,true);
});

test('an empty capacity response is not rendered as a proposed plan',async()=>{
  const app=await browser();
  app.responses.set('/api/staffing/snapshot',{...snapshot(),options:[]});
  await app.run('work(assess)');
  assert.equal(app.element('capacity-state').textContent,'No capacity options returned.');
  assert.equal(app.element('capacity-results').hidden,true);
  assert.equal(app.element('decision').hidden,true);
  assert.equal(app.element('propose').disabled,true);
});

test('refreshing a changed context invalidates the assessment and retained source',async()=>{
  const app=await browser();
  await app.run('work(assess)');
  app.responses.set('/api/staffing/snapshot',{...snapshot(),contextHash:'context-two'});
  await app.run('work(refresh)');
  assert.equal(app.element('assessment-results').hidden,true);
  assert.equal(app.element('source-details').textContent,'Not assessed.');
  assert.equal(app.element('propose').disabled,true);
  assert.match(app.element('analysis-state').textContent,/Planning records changed/);
});

test('query results escape untrusted text and do not record authorization headers',async()=>{
  const app=await browser();
  const malicious='<img src=x onerror=alert(1)>';
  const current=snapshot();current.options[1].optionName=malicious;current.options[1].reason=malicious;
  app.responses.set('/api/staffing/snapshot',current);
  app.responses.set('/api/staffing/policies',{matches:[{...policyMatches().matches[0],title:malicious,body:malicious,policyId:malicious}]});
  app.run("configuration.rehearsal=false;auth={getActiveAccount:()=>({}),acquireTokenSilent:async()=>({accessToken:'test-token'})};");
  await app.run('work(assess)');
  assert.doesNotMatch(app.element('options').innerHTML,/<img/);
  assert.doesNotMatch(app.element('policy-results').innerHTML,/<img/);
  assert.match(app.element('policy-results').innerHTML,/&lt;img/);
  assert.doesNotMatch(app.run('JSON.stringify([...results])'),/test-token|authorization/);
});

test('role, eligibility, recorded receipt and source checks still gate approvals',async()=>{
  const app=await browser();
  const awaiting={...snapshot(),state:'awaiting_approval',actor:{roles:['ROLE-HR-APPROVER']}};
  app.responses.set('/api/staffing/snapshot',awaiting);
  await app.run('work(assess)');
  assert.equal(app.element('propose').hidden,true);
  assert.equal(app.element('approve-operations').disabled,true);
  assert.equal(app.element('approve-hr').disabled,false);
  app.run("current.approvals=[{approverRole:'ROLE-HR-APPROVER'}];renderAuthorization();");
  assert.equal(app.element('approve-hr').disabled,true);
  app.run("current.approvals=[];current.options[1].eligible=false;renderAuthorization();");
  assert.equal(app.element('approve-hr').disabled,true);
  app.run("current.options[1].eligible=true;memory.applicable=false;renderAuthorization();");
  assert.equal(app.element('approve-hr').disabled,true);
});

test('a policy retrieval failure clears eligible SQL results and disables submission',async()=>{
  const app=await browser();
  await app.run('work(assess)');
  app.responses.set('/api/staffing/policies',{error:'Policy search unavailable'});
  await app.run('work(assess)');
  assert.equal(app.element('propose').disabled,true);
  assert.match(app.element('message').textContent,/Policy search unavailable/);
  assert.equal(app.element('options').innerHTML,'');
  assert.equal(app.element('assessment-results').hidden,true);
});

test('unknown approval outcomes retain the same request and reviewed hashes for a retry',async()=>{
  const app=await browser();
  app.responses.set('/api/staffing/snapshot',{...snapshot(),state:'awaiting_approval'});
  await app.run('work(assess)');
  app.responses.set('/api/staffing/approve',{error:'Write outcome unknown',writeOutcomeUnknown:true});
  await app.run("work(()=>approve('ROLE-OPERATIONS-APPROVER'))");
  const pending=app.storage.get('staffing-approval-case-test-ROLE-OPERATIONS-APPROVER');
  assert.ok(pending);
  assert.equal(JSON.parse(pending).reviewedHash,'context-one');
  assert.equal(JSON.parse(pending).reviewedMemoryHash,'memory-hash');
  assert.equal(app.run('assessmentReady'),false);
  assert.equal(app.element('approve-operations').disabled,true);
  app.responses.set('/api/staffing/snapshot',{...snapshot(),state:'awaiting_approval',contextHash:'context-two'});
  app.responses.set('/api/staffing/memory',{...retainedDecision(),hash:'memory-two'});
  await app.run('work(refresh)');
  assert.equal(app.element('approve-operations').disabled,true);
  await app.run('work(assess)');
  assert.equal(app.element('approve-operations').disabled,false);
  assert.equal(app.calls.filter(call=>call.url.endsWith('/approve')).length,1);
  await app.run("work(()=>approve('ROLE-OPERATIONS-APPROVER'))");
  assert.equal(app.storage.get('staffing-approval-case-test-ROLE-OPERATIONS-APPROVER'),pending);
  const writes=app.calls.filter(call=>call.url.endsWith('/approve'));
  assert.equal(writes[0].options.body,writes[1].options.body);
});

for(const action of ['approve','propose']){
  for(const failure of ['network','unreadable JSON','unreadable conflict','server unknown','server unknown conflict','server unknown success']){
    test(`${action} ${failure} invalidates assessment without automatically retrying the write`,async()=>{
      const app=await browser();
      app.responses.set('/api/staffing/snapshot',{...snapshot(),state:action==='approve'?'awaiting_approval':'review'});
      await app.run('work(assess)');
      assert.equal(app.element(action==='approve'?'approve-operations':'propose').disabled,false);
      app.responses.set(`/api/staffing/${action}`,failure==='network'?()=>{throw new TypeError('Failed to fetch');}
        :failure.startsWith('unreadable')?{ok:failure==='unreadable JSON',status:failure==='unreadable JSON'?200:409,json:async()=>{throw new SyntaxError('Invalid JSON');}}
        :{...(failure==='server unknown success'?{}:{error:'Outcome unknown'}),writeOutcomeUnknown:true,status:failure==='server unknown conflict'?409:failure==='server unknown success'?200:503});
      app.storage.set('unrelated-request','keep');
      const count=app.calls.length;
      await app.run(action==='approve'?"work(()=>approve('ROLE-OPERATIONS-APPROVER'))":"work(()=>api('propose',{reviewedHash:current.contextHash,reviewedMemoryHash:memory.hash}))");
      assert.deepEqual(app.calls.slice(count).map(call=>call.url),[`/api/staffing/${action}`]);
      assert.equal(app.run('assessmentReady'),false);
      assert.equal(app.run('memory'),undefined);
      assert.equal(app.run('policyResult'),undefined);
      for(const operation of ['assess','memory','policies','snapshot'])assert.equal(app.run(`results.has('${operation}')`),false);
      for(const id of ['assessment-results','conclusion','decision'])assert.equal(app.element(id).hidden,true);
      assert.equal(app.element('options').innerHTML,'');
      assert.equal(app.element('result-option').textContent,'');
      for(const id of ['propose','approve-operations','approve-hr'])assert.equal(app.element(id).disabled,true);
      assert.match(app.element('message').textContent,/Refresh and inspect approval receipts, then assess staffing again/);
      assert.equal(app.storage.get('unrelated-request'),'keep');
      const key='staffing-approval-case-test-ROLE-OPERATIONS-APPROVER';
      const pending=app.storage.get(key);
      if(action==='approve'){
        assert.ok(pending);
        assert.equal(JSON.parse(pending).reviewedHash,'context-one');
        assert.equal(JSON.parse(pending).reviewedMemoryHash,'memory-hash');
      }
      await app.run('work(refresh)');
      for(const id of ['propose','approve-operations','approve-hr'])assert.equal(app.element(id).disabled,true);
      await app.run('work(assess)');
      assert.equal(app.element(action==='approve'?'approve-operations':'propose').disabled,false);
      assert.equal(app.calls.filter(call=>/\/(approve|propose)$/.test(call.url)).length,1);
      app.responses.set(`/api/staffing/${action}`,{recorded:true});
      await app.run(action==='approve'?"work(()=>approve('ROLE-OPERATIONS-APPROVER'))":"work(()=>api('propose',{reviewedHash:current.contextHash,reviewedMemoryHash:memory.hash}))");
      const writes=app.calls.filter(call=>/\/(approve|propose)$/.test(call.url));
      assert.equal(writes.length,2);
      assert.equal(writes[1].options.body,writes[0].options.body);
      if(action==='approve'){
        assert.equal(writes[1].options.body,pending);
        assert.equal(app.storage.has(key),false);
      }
    });
  }
}

test('nonwrite transport and parse errors retain their semantics and confirmed errors retain status',async()=>{
  const app=await browser();
  for(const action of ['snapshot','assess']){
    for(const failure of ['network','parse']){
      const error=failure==='network'?new TypeError('Failed to fetch'):new SyntaxError('Invalid JSON');
      app.responses.set(`/api/staffing/${action}`,failure==='network'?()=>{throw error;}:{ok:true,status:200,json:async()=>{throw error;}});
      await assert.rejects(app.run(`api('${action}'${action==='assess'?',{}':''})`),actual=>actual===error);
      assert.equal(error.writeOutcomeUnknown,undefined);
    }
  }
  for(const action of ['snapshot','assess','approve','propose']){
    app.responses.set(`/api/staffing/${action}`,{error:'Access denied',status:403});
    await assert.rejects(app.run(`api('${action}'${action==='snapshot'?'':',{}'})`),error=>error.message==='Access denied'&&error.status===403&&error.writeOutcomeUnknown===false);
  }
});

test('production requests without an authenticated account never reach the API',async()=>{
  const app=await browser();
  app.run('configuration.rehearsal=false;auth={getActiveAccount:()=>null};');
  const callCount=app.calls.length;
  await assert.rejects(app.run("api('propose',{})"),/Sign in to continue/);
  assert.equal(app.calls.length,callCount);
});

test('view navigation is exclusive and preserves the assessed snapshot and approval gates',async()=>{
  const app=await browser();
  await app.run('work(assess)');
  const count=app.calls.length;
  for(const view of ['sources','receipts','review']){
    app.run(`showView('${view}')`);
    for(const name of ['sources','receipts','review'])assert.equal(app.element(`view-${name}`).hidden,name!==view);
    assert.equal(app.element('page-title').focused,true);
    assert.equal(app.element('propose').disabled,false);
    assert.equal(app.element('approve-hr').disabled,true);
    assert.equal(app.run('current.contextHash'),'context-one');
  }
  assert.equal(app.calls.length,count);
});

test('conclusion uses returned eligibility and shortfall instead of assuming temporary staffing succeeds',async()=>{
  const app=await browser();
  const blocked=snapshot();blocked.options[1].eligible=false;blocked.options[1].reason='Qualification pending';
  app.responses.set('/api/staffing/snapshot',blocked);
  await app.run('work(assess)');
  assert.equal(app.element('result-option').textContent,'No eligible staffing option');
  assert.equal(app.element('result-output').textContent,'');
  assert.equal(app.element('result-coverage').textContent,'');
  assert.match(app.element('result-reason').textContent,/Qualification pending/);
  assert.equal(app.element('propose').disabled,true);
  const partial=snapshot();partial.options[0].eligible=true;partial.options[1].eligible=false;
  app.responses.set('/api/staffing/snapshot',partial);
  await app.run('work(assess)');
  assert.equal(app.element('result-option').textContent,'Current staffing');
  assert.equal(app.element('result-coverage').textContent,'2,000 units short of committed demand');
  assert.equal(app.element('propose').disabled,true);
});

test('lesson, prior action, attribution and notice reason come from the assessment, not fixed copy',async()=>{
  const app=await browser();
  const assessed=snapshot();assessed.options[2].reason='SQL requires 28 days of notice.';
  app.responses.set('/api/staffing/assess',{snapshot:assessed,policies:policyMatches(),memory:{...retainedDecision(),
    priorAction:'Moved qualified colleagues from another line.',productivity:{gainPerWorker:.125,maxExtraWorkers:3},mode:'rehearsal'}});
  await app.run('work(assess)');
  assert.equal(app.element('lesson-action').textContent,'Moved qualified colleagues from another line.');
  assert.equal(app.element('lesson-productivity').textContent,'12.5% throughput gain per added packer, up to 3 packers.');
  assert.equal(app.element('lesson-origin').textContent,'Local scenario source');
  assert.equal(app.element('current-constraint').textContent,'SQL requires 28 days of notice.');
});

test('incomplete nested responses discard all previously captured assessment evidence',async()=>{
  for(const invalid of [{snapshot:snapshot()},
    {snapshot:snapshot(),policies:policyMatches(),memory:{...retainedDecision(),productivity:undefined}},
    {snapshot:snapshot(),policies:policyMatches(),memory:{...retainedDecision(),productivity:{gainPerWorker:NaN,maxExtraWorkers:2}}}]){
    const app=await browser();await app.run('work(assess)');
    app.responses.set('/api/staffing/assess',invalid);await app.run('work(assess)');
    assert.equal(app.element('assessment-results').hidden,true);
    assert.equal(app.element('propose').disabled,true);
    assert.equal(app.element('approve-operations').disabled,true);
    assert.equal(app.element('approve-hr').disabled,true);
    for(const action of ['assess','memory','policies','snapshot'])assert.equal(app.run(`results.has('${action}')`),false);
  }
});

test('retained nested snapshot and inspector origin survive a subsequent same-context refresh',async()=>{
  const app=await browser();await app.run('work(assess)');
  const captured=app.run("JSON.stringify(results.get('assess'))");
  app.responses.set('/api/staffing/snapshot',{...snapshot(),state:'awaiting_approval'});
  await app.run('work(refresh)');
  assert.equal(app.run("JSON.stringify(results.get('assess'))"),captured);
  assert.equal(app.run("results.get('assess').result.snapshot.state"),'review');
  assert.equal(app.run("inspectionResponse('snapshot').result.state"),'review');
  assert.equal(app.run("inspectionResponse('snapshot').origin"),'/api/staffing/assess');
  assert.equal(app.run("results.get('policies').origin"),'/api/staffing/assess');
  app.element('inspect-memory').listeners.click();
  assert.match(app.element('inspector-body').innerHTML,/\/api\/staffing\/assess/);
  assert.match(app.element('inspector-body').innerHTML,/resultPath.*memory/s);
});

test('confirmed stale approval conflicts invalidate assessment and remove only their pending request',async()=>{
  const app=await browser();await app.run('work(assess)');
  app.responses.set('/api/staffing/approve',{error:'Reviewed source changed',status:409});
  app.storage.set('unrelated-request','keep');
  await app.run("work(()=>approve('ROLE-OPERATIONS-APPROVER'))");
  assert.equal(app.storage.has('staffing-approval-case-test-ROLE-OPERATIONS-APPROVER'),false);
  assert.equal(app.storage.get('unrelated-request'),'keep');
  assert.equal(app.element('assessment-results').hidden,true);
  assert.equal(app.element('propose').disabled,true);
  assert.equal(app.run("results.has('assess')"),false);
  assert.match(app.element('analysis-state').textContent,/Assess staffing again/);
});

test('stale proposals invalidate review but an uncertain conflict retains its pending approval',async()=>{
  const app=await browser();await app.run('work(assess)');
  app.responses.set('/api/staffing/propose',{error:'Case changed',status:409});
  await app.run("work(()=>api('propose',{reviewedHash:current.contextHash,reviewedMemoryHash:memory.hash}))");
  assert.equal(app.element('assessment-results').hidden,true);
  assert.equal(app.element('propose').disabled,true);
  await app.run('work(assess)');
  app.responses.set('/api/staffing/approve',{error:'Outcome unknown',status:409,writeOutcomeUnknown:true});
  await app.run("work(()=>approve('ROLE-OPERATIONS-APPROVER'))");
  assert.ok(app.storage.has('staffing-approval-case-test-ROLE-OPERATIONS-APPROVER'));
  assert.equal(app.run('assessmentReady'),false);
  assert.equal(app.element('approve-operations').disabled,true);
});

test('memory dependency errors use audience-facing copy and retain no recommendation',async()=>{
  const app=await browser();await app.run('work(assess)');
  app.responses.set('/api/staffing/assess',{error:'The retained Act 2 decision could not be verified.',dependency:'cosmos'});
  await app.run('work(assess)');
  assert.equal(app.element('message').textContent,'The retained decision could not be verified. Retry assessment before submitting a plan.');
  assert.equal(app.element('assessment-results').hidden,true);
  assert.equal(app.element('propose').disabled,true);
});