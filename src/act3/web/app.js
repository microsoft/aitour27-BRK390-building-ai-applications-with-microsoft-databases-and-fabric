/* global msal, lucide */
const element = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const number = (value) => Number(value).toLocaleString('en-GB');
const date = (value) => new Date(value).toLocaleString('en-GB', { dateStyle:'medium', timeStyle:'short' });
let config, auth, snapshot, selected, busy = false;
let queryContract;
const inspectedResponses = new Map();
const icons = () => lucide.createIcons();
const signInTimeout = 'Sign-in timed out. Reload the page and sign in again.';
async function withDeadline(operation, milliseconds, timeoutMessage, cancel = () => {}) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(timeoutMessage);
        error.name = 'TimeoutError';
        reject(error); cancel();
      }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function fetchJson(url, options = {}, milliseconds = 90000) {
  const controller = new AbortController();
  const write = ['review/approve','review/draft','review/publish'].some(path => url.endsWith(path));
  const timeoutMessage = write
    ? 'Request timed out. The write outcome is unknown. Refresh and inspect receipts before retrying.'
    : 'Request timed out. The service may be starting or unreachable. Please retry.';
  return withDeadline(async () => {
    const response = await fetch(url, {...options,signal:controller.signal});
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || `Request failed (${response.status}).`),
      { writeOutcomeUnknown: result.writeOutcomeUnknown === true });
    return result;
  }, milliseconds, timeoutMessage, () => controller.abort());
}
function redactInspection(value) {
  if (Array.isArray(value)) return value.map(redactInspection);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /token|authorization|password|secret/i.test(key) ? '[redacted]' : redactInspection(item)]));
  return typeof value === 'string' ? value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]') : value;
}
function inspectorButton(operation, title, projection = '') {
  return `<button type="button" class="inspect-query" data-inspect="${escape(operation)}" data-title="${escape(title)}" data-projection="${escape(projection)}"><i data-lucide="code-xml"></i>Inspect query</button>`;
}
async function inspectQuery(button) {
  const operation = button.dataset.inspect;
  const entry = inspectedResponses.get(operation);
  if (!entry) return;
  const dialog = element('query-inspector');
  element('query-title').textContent = button.dataset.title || 'SQL query';
  element('query-content').textContent = 'Loading query contract...';
  dialog.showModal();
  try {
    queryContract ||= await request('review/retrieval-contract');
    const contract = queryContract.operations?.[operation];
    const sql = contract?.sql || (contract?.procedure
      ? `EXEC ${contract.procedure}\n  ${(contract.parameters || []).map(name => `@${name} = @${name}`).join(',\n  ')};`
      : 'No SQL contract is available for this operation.');
    element('query-content').innerHTML = `<p class="query-meta">${escape(operation)} · Response received ${escape(date(entry.receivedAt))}</p>
      <h3>${contract?.procedure ? 'Stored procedure invocation' : 'SQL query'}</h3><pre>${escape(sql)}</pre>
      <p>${escape(contract?.processing || '')}</p><p>${escape(button.dataset.projection || '')}</p>
      <p class="query-meta">Backend query contract, not an execution trace. Server-generated bindings, embeddings and token-derived actor values are not captured here.</p>
      <h3>Submitted parameters</h3><pre>${escape(JSON.stringify(entry.parameters, null, 2))}</pre>
      <p class="query-meta">SQL parameter names: ${escape((contract?.parameters || []).join(', ') || 'None')}</p>
      <details><summary>Inspect raw response</summary><pre>${escape(JSON.stringify(entry.result, null, 2))}</pre></details>`;
  } catch (error) {
    element('query-content').textContent = `Query contract unavailable: ${error.message}`;
  }
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-inspect]');
  if (button) void inspectQuery(button);
});
element('close-query').addEventListener('click', () => element('query-inspector').close());
element('query-inspector').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    element('query-inspector').close();
  }
});
function message(text, error = false) { element('message').textContent = text; element('message').hidden = !text; element('message').className = error ? 'error' : ''; }
async function work(action) {
  if (busy) return;
  busy = true; document.body.classList.add('busy'); message('');
  try { await action(); } catch (error) { message(error.message, true); }
  finally { busy = false; document.body.classList.remove('busy'); }
}
async function request(path, body) {
  const account = auth.getActiveAccount();
  if (!account) throw new Error('Sign in to continue.');
  let token;
  try { token = await withDeadline(() => auth.acquireTokenSilent({ account, scopes:[config.apiScope], redirectUri:config.silentRedirectUri }), 30000, signInTimeout); }
  catch (error) {
    if (error instanceof msal.InteractionRequiredAuthError || ['timed_out', 'monitor_window_timeout'].includes(error.errorCode)) {
      message('Refreshing Microsoft sign-in...');
      await withDeadline(() => auth.acquireTokenRedirect({ scopes:[config.apiScope], account }), 30000, signInTimeout);
    }
    throw error;
  }
  const result = await fetchJson(`/api/${path}`, { method:body ? 'POST' : 'GET',
    headers:{ authorization:`Bearer ${token.accessToken}`, ...(body ? {'content-type':'application/json'} : {}) },
    ...(body ? {body:JSON.stringify(body)} : {}) });
  if (path !== 'review/retrieval-contract') {
    inspectedResponses.set(path, {receivedAt:new Date().toISOString(), parameters:redactInspection(body || {}), result:redactInspection(result)});
    if (['review/approve','review/draft','review/publish'].includes(path)) {
      const titles = {'review/approve':'Latest approval response','review/draft':'Latest draft response','review/publish':'Latest publication response'};
      element('operation-receipts').innerHTML = [...inspectedResponses.keys()].filter(operation => titles[operation]).map(operation =>
        `<article class="receipt"><h3>${titles[operation]}</h3>${inspectorButton(operation, titles[operation])}</article>`).join('');
      icons();
    }
  }
  return result;
}
function showView(view) {
  for (const name of ['review','memory','receipts']) element(`view-${name}`).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
}
function renderDecision() {
  const option = snapshot.options.find(item => item.optionId === selected);
  if (!option) return;
  element('selected-name').textContent = option.optionName;
  const evaluation = option.evaluation;
  element('decision-details').innerHTML = `<p>${escape(option.summary)}</p><p>${escape(option.materialsConstraint)}</p><p>Maintenance: ${escape(option.maintenanceCheck.reason)}${evaluation ? ` Projected stress: ${number(evaluation.projectedStressPctOfThreshold)}%; ceiling: ${number(evaluation.stressCeilingPct)}%.` : ''}</p>`;
  const eligible = option.maintenanceCheck.permitted && option.policyCompliant && option.meetsCommitment && option.shortfallUnits === 0 && snapshot.state !== 'authorized';
  for (const [name, role] of [['operations','ROLE-OPERATIONS-APPROVER'],['maintenance','ROLE-MAINTENANCE-APPROVER']]) {
    element(`approve-${name}`).disabled = !eligible || !snapshot.actor.roles.includes(role) || snapshot.approvals.some(receipt => receipt.approverRole === role)
      || Boolean(snapshot.selectedOptionId && snapshot.selectedOptionId !== selected);
  }
  element('approval-state').textContent = snapshot.plan
    ? `Plan recorded: ${number(snapshot.plan.rateFactor * 100)}% rate, ${number(snapshot.plan.utilisation * 100)}% utilisation, ${snapshot.plan.deferralDays}-day deferral. ${date(snapshot.plan.recordedAt)}.`
    : `${snapshot.approvals.length} of 2 role approvals recorded.`;
  document.querySelectorAll('#options tr').forEach(row => row.classList.toggle('selected', row.dataset.option === selected));
}
function render() {
  element('signedout').hidden = true; element('signedin').hidden = false;
  element('connection').textContent = 'Connected';
  element('case-label').textContent = `${snapshot.lineId} / ${snapshot.caseId}`;
  element('case-status').textContent = snapshot.state === 'authorized' ? 'Plan authorized' : snapshot.state === 'awaiting_approval' ? 'Awaiting approval' : 'In review';
  element('provenance').textContent = `Synthetic scenario · ${snapshot.source.name} · Imported ${date(snapshot.importedAt)}`;
  element('incident-text').textContent = snapshot.title;
  const conflict = snapshot.conflict;
  element('metrics').innerHTML = [['Additional demand',conflict.requiredIncrementalUnits,''],['Available headroom',conflict.headroomWithMaintenanceUnits,''],['Production shortfall',conflict.shortfallUnits,'alert']].map(([label,value,style]) => `<div class="metric ${style}"><div class="label">${label}</div><span class="value">${number(value)}</span><span class="unit">units</span></div>`).join('');
  selected = snapshot.selectedOptionId || (snapshot.options.some(option => option.optionId === selected) ? selected : snapshot.options.find(option => option.recommended)?.optionId || snapshot.options[0].optionId);
  element('options').innerHTML = snapshot.options.map(option => {
    const allowed = option.maintenanceCheck.permitted && option.policyCompliant && option.meetsCommitment;
    return `<tr data-option="${escape(option.optionId)}"><td><label><input type="radio" name="option" value="${escape(option.optionId)}" ${selected === option.optionId ? 'checked' : ''}><span>${escape(option.optionName)}</span></label><p>${escape(option.effectOnExistingOrders)}</p></td><td>${number(option.requiredRateFactor*100)}% / ${number(option.requiredUtilisation*100)}%</td><td>${number(option.incrementalUnitsDelivered)} units<small>${option.shortfallUnits ? `${number(option.shortfallUnits)} short` : 'Demand met'}</small></td><td><span class="status ${allowed ? '' : 'blocked'}">${allowed ? 'Within limits' : 'Blocked'}</span><small>${option.evaluation?.requestedDeferralDays ?? 0}-day deferral</small></td></tr>`;
  }).join('');
  element('options').querySelectorAll('input').forEach(input => input.addEventListener('change', () => { selected = input.value; renderDecision(); }));
  renderDecision();
  element('memory-count').textContent = `${snapshot.guidance.length} records`;
  element('guidance-list').innerHTML = snapshot.guidance.map(item => `<article class="result"><div class="result-top"><h3>${escape(item.title)}</h3><span class="status ${item.status === 'draft' ? 'pending' : ''}">${item.status === 'source_approved' ? 'Approved source policy' : escape(item.status)}</span></div><p>${escape(item.excerpt)}</p><div class="result-meta"><span>${escape(item.policyId)} · v${escape(item.policyVersion)}</span><span>Source ${escape(item.sourceCaseId)}</span>${item.approvedAt ? `<span>Published ${date(item.approvedAt)}</span>` : ''}</div>${item.status === 'draft' && snapshot.actor.roles.includes('ROLE-ACT3-REVIEWER') ? `<button class="publish" data-publish="${escape(item.guidanceId)}"><i data-lucide="check-check"></i>Publish reviewed lesson</button>` : ''}</article>`).join('');
  element('guidance-list').querySelectorAll('[data-publish]').forEach(button => button.addEventListener('click', () => work(async () => {
    const record = snapshot.guidance.find(item => item.guidanceId === button.dataset.publish);
    await request('review/publish', { guidanceId:record.guidanceId, sourceHash:record.sourceHash });
    await refresh(); message('Lesson published. It is now eligible for retrieval.');
  })));
  element('save-draft').disabled = snapshot.state !== 'authorized' || !snapshot.actor.roles.includes('ROLE-ACT3-REVIEWER');
  element('receipts').innerHTML = snapshot.approvals.length ? snapshot.approvals.map(receipt => `<article class="receipt"><h3><i data-lucide="badge-check"></i>${receipt.approverRole === 'ROLE-OPERATIONS-APPROVER' ? 'Operations approval' : 'Maintenance approval'}</h3><dl><dt>Receipt</dt><dd><code>${escape(receipt.requestId)}</code></dd><dt>Option</dt><dd>${escape(receipt.optionId)}</dd><dt>Actor object ID</dt><dd><code>${escape(receipt.actorId)}</code></dd><dt>Recorded</dt><dd>${date(receipt.approvedAt)}</dd><dt>Reviewed state</dt><dd><code>${escape(receipt.reviewedHash)}</code></dd></dl></article>`).join('') : '<p class="result-empty">No approvals recorded.</p>';
  element('source-hash').textContent = `Source SHA-256 ${snapshot.sourceHash}`;
  icons();
}
async function refresh() { snapshot = await request('review/snapshot'); render(); }
async function approve(role) {
  const key = `pending-approval-${snapshot.caseId}-${role}`;
  const pending = JSON.parse(sessionStorage.getItem(key) || 'null') || { requestId:crypto.randomUUID(), caseId:snapshot.caseId, optionId:selected, reviewedHash:snapshot.reviewHash, approverRole:role };
  sessionStorage.setItem(key,JSON.stringify(pending));
  try {
    const receipt = await request('review/approve',pending);
    sessionStorage.removeItem(key); await refresh(); message(`Approval recorded: ${receipt.requestId}`);
  } catch (error) {
    if (error.name !== 'TimeoutError' && !error.writeOutcomeUnknown && /changed|refresh|different|already|satisfy/i.test(error.message)) sessionStorage.removeItem(key);
    throw error;
  }
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
element('refresh').addEventListener('click', () => work(refresh));
element('approve-operations').addEventListener('click', () => work(() => approve('ROLE-OPERATIONS-APPROVER')));
element('approve-maintenance').addEventListener('click', () => work(() => approve('ROLE-MAINTENANCE-APPROVER')));
element('search-form').addEventListener('submit', event => { event.preventDefault(); work(async () => {
  element('search-results').textContent = 'Retrieving from Azure SQL...';
  try {
    const result = await request('act3/guidance',{caseId:snapshot.caseId, question:element('question').value});
    element('search-results').innerHTML = result.matches.length ? result.matches.map(item => `<article class="result"><div class="result-top"><h3>${escape(item.title)}</h3><span class="status">${item.sourceType === 'policy' ? 'Policy' : 'Published lesson'}</span></div><p>${escape(item.excerpt)}</p><div class="result-meta"><span>${escape(item.policyId)} · v${escape(item.policyVersion)}</span><span>Cosine distance ${Number(item.distance).toFixed(3)}</span><span>${escape(item.sourceType === 'policy' ? 'Source policy approval' : 'Reviewer publication')}</span></div></article>`).join('') : '<p class="result-empty">No approved guidance matched this question.</p>';
    element('search-results').insertAdjacentHTML('beforeend', inspectorButton('act3/guidance', 'Guidance retrieval', 'These results are the matches returned for the submitted question.'));
    icons();
  } catch (error) { element('search-results').textContent = ''; throw error; }
}); });
element('lesson-form').addEventListener('submit', event => { event.preventDefault(); work(async () => {
  const content = {caseId:snapshot.caseId,title:element('lesson-title').value,excerpt:element('lesson-text').value};
  const cached = JSON.parse(sessionStorage.getItem('pending-lesson') || 'null');
  const payload = cached && cached.title === content.title && cached.excerpt === content.excerpt && cached.caseId === content.caseId ? cached : {...content,guidanceId:crypto.randomUUID()};
  sessionStorage.setItem('pending-lesson',JSON.stringify(payload));
  await request('review/draft',payload); sessionStorage.removeItem('pending-lesson');
  element('lesson-form').reset(); await refresh(); message('Draft saved. Publication requires a reviewer action.');
}); });
async function signIn() {
  if (!auth || !config) { location.reload(); return; }
  await withDeadline(() => auth.loginRedirect({scopes:[config.apiScope]}), 30000, signInTimeout);
}
element('signin').addEventListener('click', () => work(async () => {
  if (auth?.getActiveAccount()) await withDeadline(() => auth.logoutRedirect({postLogoutRedirectUri:config.redirectUri}), 30000, signInTimeout); else await signIn();
}));
element('signin-main').addEventListener('click', () => work(() => auth?.getActiveAccount() ? refresh() : signIn()));
work(async () => {
  icons();
  message('Connecting...');
  config = await fetchJson('/api/config', {}, 30000);
  auth = new msal.PublicClientApplication({auth:{clientId:config.clientId,authority:`https://login.microsoftonline.com/${config.tenantId}`,redirectUri:config.redirectUri},cache:{cacheLocation:'sessionStorage'}});
  await withDeadline(() => auth.initialize(), 30000, signInTimeout);
  const result = await withDeadline(() => auth.handleRedirectPromise(), 30000, signInTimeout);
  const account = result?.account || auth.getAllAccounts()[0];
  if (account) { auth.setActiveAccount(account); element('account-name').textContent = account.username; element('signin').innerHTML = '<i data-lucide="log-out"></i>Sign out'; element('signin-main').innerHTML = '<i data-lucide="refresh-cw"></i>Retry connection'; icons(); await refresh(); }
  message('');
  icons();
});