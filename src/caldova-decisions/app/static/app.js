const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const count = n => new Intl.NumberFormat('en-US').format(n);
let timer;
let generation = 0;
let currentJob;
let message = '';
function element(tag, text, cls) {const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
async function api(path) {
 const headers = $('token').value ? {Authorization:`Bearer ${$('token').value}`} : {};
 const response = await fetch(path,{headers});
 if(!response.ok) throw new Error(response.status===401?'Provide a valid access token for this remote connection.':`Request failed (${response.status})`);
 return response.json();
}
function renderDecision(p) {
 $('status').textContent=`${p.case_id} · ${p.state}${p.evaluation_id ? ` · Evaluation ${p.evaluation_id}`:''}`;
 if(p.error) throw new Error(p.error);
 if(!p.options) return;
 const selected=p.options.find(o=>o.scenario===p.selected_scenario).result;
 $('metrics').replaceChildren();
 for(const [title,value] of [['Additional investment',money(selected.extra_budget_usd)],['Additional demand',count(selected.incremental_units)],['Expected uplift',`${selected.uplift_percent}%`]]) {
  const box=element('div',title,'metric');box.append(element('strong',value));$('metrics').append(box);
 }
 const table=document.createElement('table');
 const head=document.createElement('tr');['Option','Investment','Extra units','Assessment'].forEach(t=>head.append(element('th',t)));table.append(head);
 for(const o of p.options){const tr=document.createElement('tr');if(o.scenario===p.selected_scenario)tr.className='winner';
 [o.scenario,money(o.result.extra_budget_usd),count(o.result.incremental_units),o.result.eligible?(o.scenario===p.selected_scenario?'Recommended':'Eligible'):'Fails business checks'].forEach(t=>tr.append(element('td',t)));table.append(tr);}
 $('options').replaceChildren(table);
 $('risk').textContent=`Production: ${selected.production_status}. ${count(selected.production_gap_units)} units require capacity confirmation.`;
 $('brief').textContent=p.brief?.generated_text || 'Generating the decision brief…';
 $('evidence').textContent=JSON.stringify(p.evidence,null,2);
}
function renderWorkflow(data) {
 $('pipelines').replaceChildren();
 for(const p of data.pipelines){if(!p.definition)continue;const d=p.definition;
 const card=element('article','','pipeline');card.append(element('h3',d.name));
 card.append(element('p',p.run?`Run ${p.run.id} · ${p.run.status} · ${p.run.completed_at||'In progress'}`:'Not started for this request','run'));
 const graph=element('div','','graph');graph.append(element('span','SOURCE'));
 const detail=element('pre','Select a step to inspect its deployed definition.');
 d.steps.forEach((s,i)=>{graph.append(element('span','→','arrow'));const button=element('button',`${i+1}. ${s.step.toUpperCase()}`,'node');button.append(element('small',s.model||'Text preparation'));button.onclick=()=>{detail.textContent=JSON.stringify(s,null,2);};graph.append(button);});
 graph.append(element('span','→ SAVED OUTPUT','arrow'));card.append(graph,detail);
 const execution=document.createElement('details');execution.append(element('summary','Actual AI Function calls in this run'));
 const calls=p.execution_steps.filter(n=>/azure_ai\.(extract|generate)\(/.test(n.query||''));
 execution.append(element('pre',calls.map(n=>`${n.status}\n${n.query}`).join('\n\n')||'No execution steps yet.'));
 const definition=document.createElement('details');definition.append(element('summary','Full deployed pipeline definition'),element('pre',JSON.stringify(d,null,2)));
 card.append(execution,definition);$('pipelines').append(card);
 }
}
function renderProduction(p){message=p.payload?.conversation_starter||'';
 $('handoff').textContent=p.status==='not_created'?p.explanation:`For ${p.payload?.recipient||'Production planning'} · ${p.status} · ${count(p.required_units)} units`;
 $('message').textContent=message;$('copy').hidden=!message;
}
async function load(job,version){try{
 const [p,w,h]=await Promise.all([api(`/api/jobs/${job}`),api(`/api/jobs/${job}/workflow`),api(`/api/jobs/${job}/production`)]);
 if(version!==generation)return;
 $('status').classList.remove('error');renderDecision(p);renderWorkflow(w);renderProduction(h);
 if(!['approved','failed'].includes(p.state))timer=setTimeout(()=>load(job,version),3000);
}catch(e){if(version===generation){$('status').textContent=e.message;$('status').classList.add('error');}}}
$('connect').onsubmit=e=>{e.preventDefault();clearTimeout(timer);currentJob=$('job').value.trim();generation++;load(currentJob,generation);};
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(t=>t.hidden=t.id!==b.dataset.tab);document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));});
document.querySelector('nav button').click();
$('copy').onclick=async()=>{await navigator.clipboard.writeText(message);$('copy').textContent='Copied';};
$('job').value=new URLSearchParams(location.search).get('job')||'';
if($('job').value)$('connect').requestSubmit();
