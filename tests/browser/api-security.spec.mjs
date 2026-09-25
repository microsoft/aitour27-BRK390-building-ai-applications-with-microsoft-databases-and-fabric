import { test, expect } from '@playwright/test';

test('host protects data and mutations before touching dependencies', async ({ request }) => {
  for (const path of ['staffing/snapshot', 'staffing/memory', 'staffing/contract', 'review/snapshot', 'review/retrieval-contract']) {
    for (const headers of [{}, { authorization: 'Bearer forged.payload.signature' }]) {
      const response = await request.get(`/api/${path}`, { headers });
      expect(response.status(), path).toBe(401);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(await response.text()).not.toMatch(/actorId|sourceHash|contextHash|database\.windows/);
    }
  }
  for (const path of ['staffing/propose', 'staffing/approve', 'staffing/policies', 'review/approve', 'review/draft', 'review/publish', 'act3/guidance']) {
    const response = await request.post(`/api/${path}`, { data: { approverRole: 'ROLE-HR-APPROVER', actorId: 'untrusted' } });
    expect(response.status(), path).toBe(401);
  }
});

test('asset route cannot serve prototype members or arbitrary files', async ({ request }) => {
  for (const name of ['__proto__', 'constructor', 'toString', 'local.settings.json', 'package.json', '%2e%2e%2f.env']) {
    const response = await request.get(`/api/assets/${name}`);
    expect(response.status(), name).toBe(404);
  }
  const asset = await request.get('/api/assets/staffing.js');
  expect(asset.status()).toBe(200);
  expect(asset.headers()['x-content-type-options']).toBe('nosniff');
});