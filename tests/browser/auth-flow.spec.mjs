import { test, expect } from '@playwright/test';

test('sign-in uses PKCE and the configured exact callback before any write', async ({ page }) => {
  let authorizationUrl;
  await page.route('https://login.microsoftonline.com/**', async route => {
    if (route.request().url().includes('/authorize?')) {
      authorizationUrl = new URL(route.request().url());
      await route.fulfill({ contentType: 'text/html', body: '<h1>Test identity boundary</h1>' });
    } else await route.continue();
  });
  const writes = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/')) writes.push(request.url()); });
  await page.goto('/api/staffing-app');
  await expect(page.locator('#signin-main')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await page.locator('#signin-main').click();
  await expect(page.getByRole('heading', { name: 'Test identity boundary' })).toBeVisible();
  expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('http://localhost:7089/api/app');
  expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy();
  expect(writes).toEqual([]);
});

test('configuration failure leaves the app signed out with an explicit error', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
  await page.goto('/api/staffing-app');
  await expect(page.locator('#message')).toBeVisible();
  await expect(page.locator('#signedin')).toBeHidden();
  await expect(page.locator('#account-name')).toHaveText('');
});