import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

const source=readFileSync(new URL('./web/staffing.js',import.meta.url),'utf8');
const sessionRenderer=source.slice(source.indexOf('function renderSession('),source.indexOf('function message('));

test('staffing session shows authenticated status without an email or a sign-in command',()=>{
  const elements={'account-name':{textContent:''},signin:{hidden:false}};
  runInNewContext(`${sessionRenderer}\nrenderSession(true);`,{byId:(id:keyof typeof elements)=>elements[id]});
  assert.equal(elements['account-name'].textContent,'Signed in');
  assert.equal(elements.signin.hidden,true);
  assert.doesNotMatch(source,/account\.(username|name)|\.idTokenClaims\.(email|preferred_username)/);
});

test('staffing signed-out state retains the sign-in command and clears account display',()=>{
  const elements={'account-name':{textContent:'Signed in'},signin:{hidden:true}};
  runInNewContext(`${sessionRenderer}\nrenderSession(false);`,{byId:(id:keyof typeof elements)=>elements[id]});
  assert.equal(elements['account-name'].textContent,'');
  assert.equal(elements.signin.hidden,false);
  assert.match(source,/current=await api\('snapshot'\);[\s\S]*?render\(\);/);
  assert.match(source,/if\(!configuration\.rehearsal\)renderSession\(true\)/);
});