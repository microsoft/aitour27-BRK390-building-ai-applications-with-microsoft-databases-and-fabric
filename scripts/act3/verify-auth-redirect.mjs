import assert from 'node:assert/strict';
import { loadDeploymentConfig } from './config.mjs';

const { origin } = loadDeploymentConfig();
const configResponse = await fetch(`${origin}/api/config`);
assert.equal(configResponse.status, 200);
const config = await configResponse.json();
assert.equal(config.silentRedirectUri, `${origin}/api/auth-redirect`);
const callback = await fetch(config.silentRedirectUri);
assert.equal(callback.status, 200);
assert.equal(callback.headers.get('cache-control'), 'no-store');
assert.match(callback.headers.get('content-security-policy'), /frame-ancestors 'self'/);
assert.match(callback.headers.get('content-security-policy'), /default-src 'none'/);
const html = await callback.text();
assert.match(html, /msal-redirect-bridge\.js/);
assert.match(html, /auth-redirect\.js/);
assert.doesNotMatch(html, /assets\/app\.js/);
for (const asset of ['msal-redirect-bridge.js', 'auth-redirect.js']) {
  const response = await fetch(`${origin}/api/assets/${asset}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /broadcastResponseToMainFrame/);
}
const application = await fetch(`${origin}/api/app`);
assert.equal(application.status, 200);
assert.match(application.headers.get('content-security-policy'), /frame-ancestors 'none'/);
assert.match(await application.text(), /app\.js\?v=20260909-auth-bridge/);
console.log('PASS: deployed callback, bridge assets, silent configuration and main-app framing protection.');