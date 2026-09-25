import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { EntraAccessTokenVerifier } from './auth.ts';

test('real JWT verification rejects forged, expired, incomplete and cross-tenant tokens', async (context) => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const actorId = '00000000-0000-0000-0000-000000000002';
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const key = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  context.mock.method(globalThis, 'fetch', async (url: unknown) => {
    assert.equal(String(url), `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`);
    return new Response(JSON.stringify({ keys: [key] }), { headers: { 'content-type': 'application/json' } });
  });
  const verifier = new EntraAccessTokenVerifier({ tenantId, audience: 'test-api' });
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, aud: 'test-api', iat: now, nbf: now - 1, exp: now + 300,
    oid: actorId, roles: ['ROLE-ACT3-READER'] };
  const sign = (payload: Record<string, unknown>) => new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
  assert.deepEqual(await verifier.verify(`Bearer ${await sign(claims)}`), { objectId: actorId, roles: claims.roles });
  for (const changed of [{ exp: now - 10 }, { aud: 'other-api' }, { iss: `${issuer}/other` },
    { nbf: now + 60 }, { roles: 'ROLE-ACT3-READER' }, { oid: 'not-an-object-id' }]) {
    await assert.rejects(verifier.verify(`Bearer ${await sign({ ...claims, ...changed })}`), JSON.stringify(changed));
  }
  const { exp, ...withoutExpiry } = claims;
  await assert.rejects(verifier.verify(`Bearer ${await sign(withoutExpiry)}`), 'expiry is mandatory');
  await assert.rejects(verifier.verify('Bearer unsigned.payload.signature'));
  await assert.rejects(verifier.verify(undefined));
});