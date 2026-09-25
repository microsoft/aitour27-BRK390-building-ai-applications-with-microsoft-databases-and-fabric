/* global msal, lucide */
const byId=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const formatNumber=value=>Number(value).toLocaleString('en-GB');
const formatDate=value=>new Date(value).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'});
let configuration,auth,current,memory,policyResult,working=false,assessmentReady=false;
const results=new Map();
function icons(){lucide.createIcons();}
function showView(name,focus=true){
  const titles={review:'Production review',sources:'Sources',receipts:'Approvals'};
  if(!Object.hasOwn(titles,name))return;
  for(const view of Object.keys(titles))byId(`view-${view}`).hidden=view!==name;
  document.querySelectorAll('nav [data-view]').forEach(button=>{
    const active=button.dataset.view===name;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  byId('page-title').textContent=titles[name];
  if(focus){byId('page-title').focus({preventScroll:true});byId('page-title').scrollIntoView({block:'nearest'});}
}
function renderConclusion(){
  byId('conclusion').hidden=!assessmentReady;
  if(!assessmentReady)return;
  const reassignment=current.options.find(value=>value.optionId==='reassign');
  byId('lesson-origin').textContent=memory.mode==='cosmos'?'Azure Cosmos DB':'Local scenario source';
  byId('lesson-action').textContent=memory.priorAction;
  byId('lesson-finding').textContent=memory.finding;
  byId('lesson-productivity').textContent=`${formatNumber(memory.productivity.gainPerWorker*100)}% throughput gain per added packer, up to ${formatNumber(memory.productivity.maxExtraWorkers)} packers.`;
  byId('current-option').textContent=reassignment?.optionName??'Reassignment not returned';
  byId('current-eligibility').textContent=reassignment?(reassignment.eligible?'Eligible':'Blocked'):'Unavailable';
  byId('current-eligibility').className=reassignment?(reassignment.eligible?'status':'status blocked'):'status unavailable';
  byId('constraint-card').className=reassignment&&!reassignment.eligible?'constraint-blocked':'';
  byId('current-constraint').textContent=reassignment?.reason??'No reassignment check was returned by SQL.';
  const option=current.options.find(value=>value.eligible);
  byId('result-option').textContent=option?.optionName??(current.options.length?'No eligible staffing option':'No capacity options returned.');
  byId('result-eligibility').textContent=option?'SQL eligible':'Unavailable';
  byId('result-eligibility').className=option?'status':'status blocked';
  byId('result-output').textContent=option?`${formatNumber(option.outputUnits)} units projected`:'';
  byId('result-coverage').textContent=option?(option.shortfallUnits?`${formatNumber(option.shortfallUnits)} units short of committed demand`:`Demand covered: ${formatNumber(current.demandUnits)} units`):'';
  byId('result-reason').textContent=option?.reason??current.options.map(value=>`${value.optionName}: ${value.reason}`).join(' ');
}
function renderSession(signedIn){
  byId('account-name').textContent=signedIn?'Signed in':'';
  byId('signin').hidden=signedIn;
}
function message(text,error=false){byId('message').textContent=text;byId('message').hidden=!text;byId('message').className=error?'error':'';}
async function deadline(operation,milliseconds){
  let timer;
  try{return await Promise.race([operation(),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Authentication did not finish. Retry sign-in.'),{name:'TimeoutError'})),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
async function jsonRequest(url,options={}){
  const controller=new AbortController();
  const write=options.method==='POST' && /\/(approve|propose)$/.test(url);
  const timer=setTimeout(()=>controller.abort(),90000);
  let responseRead=false;
  try{
    const response=await fetch(url,{...options,signal:controller.signal});
    const body=await response.json();
    responseRead=true;
    if(!response.ok||(write&&body?.writeOutcomeUnknown===true))throw Object.assign(new Error(body.dependency==='cosmos'?'The retained decision could not be verified. Retry assessment before submitting a plan.':body.error||`Request failed (${response.status})`),{writeOutcomeUnknown:body.writeOutcomeUnknown===true,status:response.status});
    return body;
  }catch(error){
    if(write&&(!responseRead||controller.signal.aborted||error.writeOutcomeUnknown))throw Object.assign(new Error('The write outcome could not be confirmed. Refresh and inspect approval receipts, then assess staffing again before retrying.'),{writeOutcomeUnknown:true,status:error.status});
    if(controller.signal.aborted)throw Object.assign(new Error('The service timed out. Retry to reconnect.'),{writeOutcomeUnknown:false});
    throw error;
  }
  finally{clearTimeout(timer);}
}
async function api(action,body){
  let headers={};
  if(configuration.rehearsal){headers['x-act3-rehearsal']='1';}
  else{
    const account=auth.getActiveAccount();if(!account)throw new Error('Sign in to continue.');
    let token;
    try{token=await deadline(()=>auth.acquireTokenSilent({account,scopes:[configuration.apiScope],redirectUri:configuration.silentRedirectUri}),30000);}
    catch(error){if(error instanceof msal.InteractionRequiredAuthError || ['timed_out','monitor_window_timeout'].includes(error.errorCode)){
      await deadline(()=>auth.acquireTokenRedirect({account,scopes:[configuration.apiScope]}),30000);
    }throw error;}
    headers.authorization=`Bearer ${token.accessToken}`;
  }
  if(body)headers['content-type']='application/json';
  const origin=`/api/staffing/${action}`;
  let result;
  try{result=await jsonRequest(origin,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});}
  catch(error){
    if(['approve','propose'].includes(action)&&(error.writeOutcomeUnknown||error.status===409)){
      clearAssessment(error.writeOutcomeUnknown?error.message:'Reviewed records changed. Assess staffing again before submitting.');renderAuthorization();
    }
    throw error;
  }
  if(action!=='contract')results.set(action,{origin,parameters:body??{},result,receivedAt:new Date().toISOString()});
  return result;
}
async function work(operation){
  if(working)return;working=true;document.body.classList.add('busy');message('');
  byId('assess').disabled=true;byId('refresh').disabled=true;
  if(current)renderAuthorization();
  try{await operation();}catch(error){message(error.message,true);}
  finally{working=false;document.body.classList.remove('busy');byId('assess').disabled=false;byId('refresh').disabled=false;if(current)renderAuthorization();}
}
function renderAuthorization(){
  const option=current.options.find(value=>value.optionId==='temporary');
  const sourceReady=assessmentReady&&memory?.applicable===true;
  byId('propose').disabled=working||!sourceReady||!option?.eligible||current.state!=='review'||!current.actor.roles.includes('ROLE-OPERATIONS-APPROVER');
  byId('propose').hidden=current.state!=='review';
  for(const [name,role] of [['operations','ROLE-OPERATIONS-APPROVER'],['hr','ROLE-HR-APPROVER']]){
    byId(`approve-${name}`).disabled=working||!sourceReady||!option?.eligible||current.state!=='awaiting_approval'||!current.actor.roles.includes(role)||current.approvals.some(receipt=>receipt.approverRole===role);
  }
  byId('proposal-state').textContent=current.state==='review'?'For review':current.state==='authorized'?'Authorized':'Awaiting approvals';
  byId('proposal-details').textContent=sourceReady&&option
    ?`Add ${current.extraWorkers} qualified packers to the existing shifts. Projected output: ${formatNumber(option.outputUnits)} units. Existing employee schedules remain unchanged.`
    :'Decision source unverified. Submission unavailable.';
  byId('readiness').textContent=`Qualification ${current.qualified?'confirmed':'pending'} / Onboarding ready ${formatDate(current.onboardingReadyAt)} UTC`;
  byId('approval-state').textContent=current.plan?`Plan recorded in Azure SQL at ${formatDate(current.plan.recordedAt)} UTC. ${formatNumber(current.plan.outputUnits)} units planned.`:`${current.approvals.length} of 2 role approvals recorded.`;
}
function render(){
  const dataset=current.datasetContext?JSON.parse(current.datasetContext):{};
  const operatingDates=current.operatingDates?JSON.parse(current.operatingDates):[];
  byId('signedout').hidden=true;byId('signedin').hidden=false;byId('connection').textContent='Connected';
  if(!configuration.rehearsal)renderSession(true);
  byId('case-label').textContent=`${current.lineId} / ${current.caseId}`;
  byId('case-status').textContent=current.state.replaceAll('_',' ');
  byId('planning-date').textContent=`Planning date: ${formatDate(current.planningNow)} UTC | Production: ${formatDate(current.windowStart)} to ${formatDate(current.windowEnd)} UTC`;
  byId('incident-text').textContent=`${current.factoryId} / ${current.lineId}`;
  byId('product-name').textContent=dataset.productName||'Production review';
  byId('dataset-details').textContent=`${dataset.productName||''} / ${dataset.productId||''} | ${current.factoryId} / ${current.lineId} | Earlier case: ${dataset.sourceCaseId||'Unavailable'} | Dataset SHA-256: ${dataset.sourceHash||'Unavailable'}`;
  byId('calendar-details').textContent=`${operatingDates.length} operating days in this production window. Daily baseline: ${formatNumber(current.dailyOutput)} units. Production ceiling: ${formatNumber(current.machineDailyLimit)} units per operating day.`;
  const baseline=current.options.find(value=>value.optionId==='unchanged');
  const demandUnmet=Number.isFinite(baseline?.shortfallUnits)&&baseline.shortfallUnits>0;
  byId('demand-warning').hidden=!demandUnmet;
  byId('shortfall-label').textContent=demandUnmet?`${formatNumber(baseline.shortfallUnits)} units short of committed demand`:'';
  byId('shortfall-detail').textContent=demandUnmet?`Current staffing covers ${formatNumber(baseline.outputUnits)} of ${formatNumber(current.demandUnits)} units in the production window.`:'';
  byId('metrics').innerHTML=[['Committed demand',current.demandUnits,'units',demandUnmet],['Daily baseline',current.dailyOutput,'units / day',false],['Available temporary packers',current.temporaryAvailable,'people',false]].map(([label,value,unit,warning])=>`<div class="metric${warning?' metric-shortfall':''}"><div class="label">${label}</div><span class="value">${formatNumber(value)}</span><span class="unit">${unit}</span></div>`).join('');
  byId('capacity-fill').style.width=`${baseline&&current.demandUnits>0?Math.min(100,baseline.outputUnits/current.demandUnits*100):0}%`;
  byId('capacity-summary').textContent=baseline?`Baseline ${formatNumber(baseline.outputUnits)} units / Shortfall ${formatNumber(baseline.shortfallUnits)} units`:'';
  byId('model-label').textContent=`${formatNumber(current.gainPerWorker*100)}% model gain per added packer / maximum ${current.maxExtraWorkers}, capped by the production ceiling`;
  byId('options').innerHTML=assessmentReady?current.options.map(option=>`<tr><td>${escapeHtml(option.optionName)}</td><td>${formatNumber(option.addedWorkers)}</td><td>${formatNumber(option.outputUnits)}<small>${option.shortfallUnits?`${formatNumber(option.shortfallUnits)} units short`:'Demand covered'}</small></td><td><span class="status ${option.eligible?'':'blocked'}">${option.eligible?'Eligible':'Blocked'}</span><p class="option-reason">${escapeHtml(option.reason)}</p></td></tr>`).join(''):'';
  byId('receipts').innerHTML=current.approvals.length?current.approvals.map(receipt=>`<article class="receipt"><h3>${receipt.approverRole==='ROLE-HR-APPROVER'?'HR':'Operations'} approval</h3><dl><dt>Request</dt><dd>${escapeHtml(receipt.requestId)}</dd><dt>Actor</dt><dd>${escapeHtml(receipt.actorId)}</dd><dt>Recorded</dt><dd>${formatDate(receipt.approvedAt)} UTC</dd><dt>Reviewed context</dt><dd><code>${escapeHtml(receipt.contextHash)}</code></dd></dl></article>`).join(''):'<p>No approvals recorded.</p>';
  renderConclusion();renderAuthorization();icons();
}
async function refresh(){
  const previous=current?.contextHash;
  try{current=await api('snapshot');}
  catch(error){clearAssessment('Current records could not be refreshed. Assessment required.');if(current)renderAuthorization();throw error;}
  if(previous&&previous!==current.contextHash)clearAssessment('Planning records changed. Assessment required.');
  render();
}
function clearAssessment(state='Not assessed.'){
  memory=undefined;policyResult=undefined;assessmentReady=false;
  results.delete('assess');results.delete('memory');results.delete('policies');
  if(results.get('snapshot')?.origin==='/api/staffing/assess')results.delete('snapshot');
  byId('assessment-results').hidden=true;byId('assessment-results').setAttribute('aria-busy','false');
  byId('conclusion').hidden=true;
  for(const id of ['result-option','result-eligibility','result-output','result-coverage','result-reason','result-source-state','lesson-origin','lesson-action','lesson-finding','lesson-productivity','current-option','current-constraint','workforce-priority'])byId(id).textContent='';
  byId('approval-review-state').hidden=false;
  byId('approval-review-state').textContent=state==='Not assessed.'?'Assess staffing before submitting a plan.':state;
  byId('capacity-results').hidden=true;byId('memory-results').hidden=true;byId('decision').hidden=true;byId('policy-query').hidden=true;
  for(const id of ['policy-results','options'])byId(id).innerHTML='';
  for(const id of ['memory-finding','prior-action','memory-origin','assessed-at','assessed-question','capacity-state','policy-state','memory-state'])byId(id).textContent='';
  byId('policy-state').textContent='Not assessed.';byId('memory-state').textContent='Not assessed.';
  byId('source-details').textContent='Not assessed.';byId('analysis-state').textContent=state;
}
async function assess(){
  const question=byId('question').value;
  clearAssessment('Assessment in progress...');renderAuthorization();
  byId('assessment-results').hidden=false;byId('assessment-results').setAttribute('aria-busy','true');
  byId('capacity-state').hidden=false;
  byId('capacity-state').textContent='Calculating capacity...';byId('policy-state').textContent='Retrieving policies...';byId('memory-state').textContent='Retrieving decision...';
  try{
    const assessment=await api('assess',{question});
    if(!assessment.snapshot||!Array.isArray(assessment.snapshot.options)||!Array.isArray(assessment.policies?.matches)||
      assessment.memory?.applicable!==true||!assessment.memory.hash||!assessment.memory.memory||
      !assessment.memory.priorAction||!assessment.memory.finding||!assessment.memory.workforcePriority||
      !Number.isFinite(assessment.memory.productivity?.gainPerWorker)||assessment.memory.productivity.gainPerWorker<=0||
      !Number.isInteger(assessment.memory.productivity?.maxExtraWorkers)||assessment.memory.productivity.maxExtraWorkers<=0){
      throw new Error('Assessment response is incomplete. Retry assessment.');
    }
    current=assessment.snapshot;memory=assessment.memory;policyResult=assessment.policies;
    const captured=results.get('assess');
    for(const key of ['snapshot','memory','policies'])results.set(key,{...captured,resultPath:key,result:assessment[key]});
    assessmentReady=true;render();
    byId('capacity-state').textContent=current.options.length?'Calculated for the production window.':'No capacity options returned.';
    byId('capacity-state').hidden=Boolean(current.options.length);
    byId('capacity-results').hidden=!current.options.length;
      byId('policy-query').hidden=false;
      byId('policy-state').textContent=policyResult.matches.length?`${policyResult.matches.length} policy matches`:'No policies matched. SQL eligibility checks remain in effect.';
      byId('policy-results').innerHTML=policyResult.matches.map(policy=>`<article><h3>${escapeHtml(policy.title)}</h3><p>${escapeHtml(policy.body)}</p><details><summary>Policy source</summary><small>${escapeHtml(policy.policyId)} / ${escapeHtml(policy.policyVersion)} / ${policy.lineId?escapeHtml(policy.lineId):'Factory-wide'} / Distance ${Number(policy.distance).toFixed(3)}</small></details></article>`).join('');
      byId('memory-origin').textContent=memory.mode==='cosmos'?'Azure Cosmos DB':'Local scenario source';
      byId('memory-state').textContent=memory.applicable?'Applicable to this line':'No applicable decision. Submission unavailable.';
      byId('memory-results').hidden=false;byId('memory-finding').textContent=memory.finding;byId('prior-action').textContent=memory.priorAction;
      byId('workforce-priority').textContent=memory.workforcePriority;
      byId('source-details').textContent=`${memory.source} | ${memory.memory.author} | ${formatDate(memory.memory.recordedAt)} UTC | ${memory.memory.caseId}`;
    byId('decision').hidden=!current.options.length;
    byId('approval-review-state').hidden=Boolean(current.options.length);
    byId('approval-review-state').textContent='No capacity options returned. Assessment required.';
    byId('result-source-state').textContent='Azure SQL Database / Operations and HR approvals required';
    byId('assessed-at').textContent=`${formatDate(new Date())} UTC`;
    byId('assessed-question').textContent=question;
    byId('analysis-state').textContent='Assessment complete.';
  }catch(error){
    clearAssessment('Assessment failed. Retry assessment.');
    throw error;
  }finally{
    byId('assessment-results').setAttribute('aria-busy','false');renderAuthorization();
    showView('review',false);
    byId('assessment-results').focus({preventScroll:true});
    byId('assessment-results').scrollIntoView({block:'nearest'});
  }
}
async function approve(role){
  const key=`staffing-approval-${current.caseId}-${role}`;
  const pending=JSON.parse(sessionStorage.getItem(key)||'null')??{requestId:crypto.randomUUID(),reviewedHash:current.contextHash,reviewedMemoryHash:memory.hash,approverRole:role};
  sessionStorage.setItem(key,JSON.stringify(pending));
  try{await api('approve',pending);sessionStorage.removeItem(key);await refresh();message('Approval recorded.');}
  catch(error){if(error.status===409&&!error.writeOutcomeUnknown)sessionStorage.removeItem(key);throw error;}
}
function openInspector(title,html){byId('inspector-title').textContent=title;byId('inspector-body').innerHTML=html;byId('inspector').showModal();byId('inspector').scrollTop=0;byId('inspector-body').scrollTop=0;}
function inspectionResponse(action){
  const assessment=results.get('assess');
  return assessment&&['snapshot','memory','policies'].includes(action)
    ?{...assessment,resultPath:action,result:assessment.result[action]}
    :results.get(action)??{message:'No response captured for this operation.'};
}
document.addEventListener('click',event=>{
  const view=event.target.closest('[data-view]');
  if(view)showView(view.dataset.view);
  const inspect=event.target.closest('[data-inspect]');
  if(inspect)work(async()=>{const action=inspect.dataset.inspect;const contract=(await api('contract'))[action];
    openInspector('Azure SQL inspection',`<h3>Operation contract</h3><pre>${escapeHtml(contract.sql)}</pre><p>${escapeHtml(contract.processing)}</p><h3>Captured response</h3><pre>${escapeHtml(JSON.stringify(inspectionResponse(action),null,2))}</pre>`);});
});
byId('close-inspector').addEventListener('click',()=>byId('inspector').close());
byId('inspect-memory').addEventListener('click',()=>openInspector('Retained decision source',`<pre>${escapeHtml(JSON.stringify(inspectionResponse('memory'),null,2))}</pre>`));
byId('analysis-form').addEventListener('submit',event=>{event.preventDefault();work(assess);});
byId('refresh').addEventListener('click',()=>work(refresh));
byId('propose').addEventListener('click',()=>work(async()=>{await api('propose',{reviewedHash:current.contextHash,reviewedMemoryHash:memory.hash});await refresh();message('Proposal recorded. Operations and HR approvals are required.');}));
byId('approve-operations').addEventListener('click',()=>work(()=>approve('ROLE-OPERATIONS-APPROVER')));
byId('approve-hr').addEventListener('click',()=>work(()=>approve('ROLE-HR-APPROVER')));
async function signIn(){if(configuration.rehearsal){await refresh();return;}await deadline(()=>auth.loginRedirect({scopes:[configuration.apiScope]}),30000);}
byId('signin-main').addEventListener('click',()=>work(signIn));
byId('signin').addEventListener('click',()=>work(signIn));
work(async()=>{
  icons();configuration=await jsonRequest('/api/config');
  if(configuration.rehearsal){
    if(!['localhost','127.0.0.1'].includes(location.hostname))throw new Error('Rehearsal identity is restricted to loopback.');
    byId('rehearsal').hidden=false;byId('account-name').textContent='Rehearsal identity';byId('signin').hidden=true;await refresh();return;
  }
  auth=new msal.PublicClientApplication({auth:{clientId:configuration.clientId,authority:`https://login.microsoftonline.com/${configuration.tenantId}`,redirectUri:configuration.redirectUri},cache:{cacheLocation:'sessionStorage'}});
  await deadline(()=>auth.initialize(),30000);const result=await deadline(()=>auth.handleRedirectPromise(),30000);
  const account=result?.account??auth.getAllAccounts()[0];
  renderSession(false);
  if(account){auth.setActiveAccount(account);await refresh();}
});