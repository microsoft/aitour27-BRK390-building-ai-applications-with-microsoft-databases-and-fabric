import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8');

function browser() {
  const elements = new Map();
  const calls = [];
  const responses = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      innerHTML:'', textContent:'', hidden:false, open:false,
      listeners:{},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      showModal() { this.open = true; },
      close() { this.open = false; },
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    setTimeout, clearTimeout, AbortController,
    document:{getElementById:element, addEventListener() {}, querySelectorAll:() => [], body:{classList:{add() {},remove() {}}}},
    lucide:{createIcons() {}},
    msal:{InteractionRequiredAuthError:class extends Error {}},
    fetch:async (url, options) => {
      calls.push({url,options});
      const response = responses.get(url);
      return {ok:Boolean(response),status:response ? 200 : 503,json:async () => response || {error:'Unavailable'}};
    },
  });
  vm.runInContext(source, context);
  vm.runInContext("config={apiScope:'test'}; auth={getActiveAccount:()=>({}),acquireTokenSilent:async()=>({accessToken:'test-secret'})};", context);
  return {context,element,calls,responses,run:(code) => vm.runInContext(code, context)};
}

test('silent renewal uses a dedicated callback, not the application page', async () => {
  const app = browser();
  app.responses.set('/api/review/snapshot', {state:'review'});
  app.run(`config.silentRedirectUri = 'https://example.test/api/auth-redirect';
    auth.acquireTokenSilent = async (request) => { globalThis.silentRequest = request; return {accessToken:'test-secret'}; };`);
  await app.run("request('review/snapshot')");
  assert.equal(app.run('silentRequest.redirectUri'), 'https://example.test/api/auth-redirect');
});

test('callback loads only the MSAL bridge and safely handles failures', async () => {
  const html = readFileSync(new URL('./web/auth-redirect.html', import.meta.url), 'utf8');
  assert.match(html, /msal-redirect-bridge\.js/);
  assert.doesNotMatch(html, /assets\/app\.js|assets\/msal\.js/);
  const callback = readFileSync(new URL('./web/auth-redirect.js', import.meta.url), 'utf8');
  let calls = 0;
  const statusElement = {textContent:''};
  vm.runInNewContext(callback, {msalRedirectBridge:{broadcastResponseToMainFrame:async () => {calls++; throw new Error('private auth response');}}, document:{getElementById:() => statusElement}});
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.match(statusElement.textContent, /Return to the application/);
  assert.doesNotMatch(statusElement.textContent, /private auth response/);
});

test('silent redirect bridge timeout starts top-level sign-in before any API write', async () => {
  const app = browser();
  app.run(`auth.acquireTokenSilent = async () => { throw Object.assign(new Error('bridge timeout'), {errorCode:'timed_out'}); };
    auth.acquireTokenRedirect = async (request) => { globalThis.redirectRequest = request; };`);
  await assert.rejects(app.run("request('review/approve',{requestId:'retained-request'})"), /bridge timeout/);
  assert.ok(app.run('redirectRequest.account'));
  assert.ok(app.run('redirectRequest.scopes.length === 1'));
  assert.equal(app.calls.filter(call => call.url === '/api/review/approve').length, 0);
});

test('inspector binds escaped SQL and submitted values to the received result, without credentials', async () => {
  const app = browser();
  app.responses.set('/api/act3/guidance', {matches:[{excerpt:'<script>result</script>',access_token:'private',nested:{password:'hidden'}}]});
  app.responses.set('/api/review/retrieval-contract', {operations:{'act3/guidance':{
    sql:"SELECT VECTOR_DISTANCE('cosine', @embedding, embedding) WHERE distance < @maxDistance",
    parameters:['embedding','maxDistance'],processing:'Approved-only retrieval',
  }}});
  await app.run("request('act3/guidance',{question:'<img src=x> Bearer sensitive',caseId:'test-case'})");
  await app.run("inspectQuery({dataset:{inspect:'act3/guidance',title:'Guidance'}})");
  const html = app.element('query-content').innerHTML;
  assert.equal(app.element('query-inspector').open, true);
  assert.match(html, /VECTOR_DISTANCE/);
  assert.match(html, /distance &lt; @maxDistance/);
  assert.match(html, /&lt;img src=x&gt; Bearer \[redacted\]/);
  assert.match(html, /&lt;script&gt;result&lt;\/script&gt;/);
  assert.doesNotMatch(html, /test-secret|sensitive|private|hidden/);
  assert.match(html, /not an execution trace/);
  await app.run("inspectQuery({dataset:{inspect:'act3/guidance'}})");
  assert.equal(app.calls.filter(call => call.url.endsWith('retrieval-contract')).length, 1);
});

test('empty results keep a query inspector and later requests cannot change the captured parameters', async () => {
  const app = browser();
  app.responses.set('/api/act3/guidance', {matches:[]});
  app.responses.set('/api/review/retrieval-contract', {operations:{'act3/guidance':{sql:'SELECT TOP (5) guidanceId FROM act3.guidance',parameters:[]}}});
  await app.run("const payload={question:'original'}; awaitable=request('act3/guidance',payload)");
  await app.run('awaitable');
  app.run("payload.question='edited after retrieval'");
  await app.run("inspectQuery({dataset:{inspect:'act3/guidance'}})");
  assert.match(app.element('query-content').innerHTML, /original/);
  assert.doesNotMatch(app.element('query-content').innerHTML, /edited after retrieval/);
  assert.match(app.element('query-content').innerHTML, /\[\]/);
});

test('write responses show the actual procedure invocation and do not invent actor bindings', async () => {
  const app = browser();
  app.responses.set('/api/review/approve', {requestId:'test-receipt'});
  app.responses.set('/api/review/retrieval-contract', {operations:{'review/approve':{
    procedure:'act3.approve_option',parameters:['requestId','actorId'],processing:'Token-derived identity',
  }}});
  await app.run("request('review/approve',{requestId:'test-receipt'})");
  await app.run("inspectQuery({dataset:{inspect:'review/approve',title:'Latest approval response'}})");
  assert.match(app.element('operation-receipts').innerHTML, /data-inspect="review\/approve"/);
  assert.match(app.element('query-content').innerHTML, /EXEC act3.approve_option/);
  assert.match(app.element('query-content').innerHTML, /@actorId = @actorId/);
  assert.equal(app.run("'actorId' in inspectedResponses.get('review/approve').parameters"), false);
});

test('failed requests are not retained as successful results and catalog failures are explicit', async () => {
  const app = browser();
  await assert.rejects(app.run("request('review/approve',{})"), /Unavailable/);
  assert.equal(app.run("inspectedResponses.has('review/approve')"), false);
  app.responses.set('/api/review/snapshot', {state:'review'});
  await app.run("request('review/snapshot')");
  await app.run("inspectQuery({dataset:{inspect:'review/snapshot'}})");
  assert.equal(app.element('query-content').textContent, 'Query contract unavailable: Unavailable');
});

test('Escape and close button dismiss the inspector', () => {
  const app = browser();
  const dialog = app.element('query-inspector');
  dialog.showModal();
  let prevented = false;
  dialog.listeners.keydown({key:'Escape',preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.equal(dialog.open, false);
  dialog.showModal();
  app.element('close-query').listeners.click();
  assert.equal(dialog.open, false);
});

test('stalled response bodies time out, abort and release the busy state without recording success', async () => {
  const app = browser();
  await new Promise(resolve => setImmediate(resolve));
  app.context.setTimeout = callback => setTimeout(callback, 5);
  app.context.fetch = async (url, options) => {
    app.calls.push({url,options});
    return {ok:true,json:() => new Promise(() => {})};
  };
  await app.run("work(() => request('review/approve',{requestId:'retained'}))");
  assert.equal(app.run('busy'), false);
  assert.match(app.element('message').textContent, /write outcome is unknown/);
  assert.equal(app.calls.filter(call => call.url.endsWith('review/approve')).length, 1);
  assert.equal(app.calls.at(-1).options.signal.aborted, true);
  assert.equal(app.run("inspectedResponses.has('review/approve')"), false);
});

test('stalled authentication releases controls without issuing an API request', async () => {
  const app = browser();
  await new Promise(resolve => setImmediate(resolve));
  app.context.setTimeout = callback => setTimeout(callback, 5);
  app.run('auth.acquireTokenSilent=()=>new Promise(()=>{})');
  await app.run("work(() => request('review/snapshot'))");
  assert.equal(app.run('busy'), false);
  assert.match(app.element('message').textContent, /Sign-in timed out/);
  assert.equal(app.calls.some(call => call.url.endsWith('review/snapshot')), false);
});

test('configuration and inspector stalls terminate with an actionable error', async () => {
  const app = browser();
  await new Promise(resolve => setImmediate(resolve));
  app.context.setTimeout = callback => setTimeout(callback, 5);
  app.context.fetch = () => new Promise(() => {});
  await assert.rejects(app.run("fetchJson('/api/config',{},30000)"), /Request timed out/);
  app.run("inspectedResponses.set('review/snapshot',{parameters:{},result:{},receivedAt:new Date().toISOString()})");
  await app.run("inspectQuery({dataset:{inspect:'review/snapshot'}})");
  assert.match(app.element('query-content').textContent, /Query contract unavailable: Request timed out/);
});

test('approval timeout preserves its pending request ID for deliberate retry', async () => {
  const app = browser();
  await new Promise(resolve => setImmediate(resolve));
  const stored = new Map();
  app.context.sessionStorage = {getItem:key => stored.get(key),setItem:(key,value) => stored.set(key,value),removeItem:key => stored.delete(key)};
  app.context.crypto = {randomUUID:() => 'original-request-id'};
  app.context.setTimeout = callback => setTimeout(callback, 5);
  app.context.fetch = () => new Promise(() => {});
  app.run("snapshot={caseId:'case',reviewHash:'hash'};selected='option'");
  await assert.rejects(app.run("approve('ROLE-OPERATIONS-APPROVER')"), error => error.name === 'TimeoutError');
  assert.equal(JSON.parse(stored.get('pending-approval-case-ROLE-OPERATIONS-APPROVER')).requestId, 'original-request-id');
});

test('server-side uncertain write preserves its pending approval ID without retrying', async () => {
  const app = browser();
  await new Promise(resolve => setImmediate(resolve));
  const stored = new Map();
  app.context.sessionStorage = {getItem:key => stored.get(key),setItem:(key,value) => stored.set(key,value),removeItem:key => stored.delete(key)};
  app.context.crypto = {randomUUID:() => 'original-request-id'};
  let calls = 0;
  app.context.fetch = async () => { calls++; return {ok:false,json:async()=>({
    error:'The write outcome is unknown. Refresh the case and inspect receipts before retrying.',writeOutcomeUnknown:true,
  })}; };
  app.run("snapshot={caseId:'case',reviewHash:'hash'};selected='option'");
  await assert.rejects(app.run("approve('ROLE-OPERATIONS-APPROVER')"), error => error.writeOutcomeUnknown === true);
  assert.equal(JSON.parse(stored.get('pending-approval-case-ROLE-OPERATIONS-APPROVER')).requestId, 'original-request-id');
  assert.equal(calls, 1);
});