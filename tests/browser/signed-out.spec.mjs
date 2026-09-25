import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`signed-out routes load real assets without exposing case data at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    const writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/')) writes.push(request.url()); });
    for (const route of ['staffing-app', 'app']) {
      await page.goto(`/api/${route}`);
      await expect(page.locator('#signin-main')).toBeVisible();
      await expect(page.locator('#signedin')).toBeHidden();
      await expect(page.locator('#account-name')).toHaveText('');
      await expect.poll(() => page.locator('img[alt="Azure SQL Database"]').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
      await expect(page.locator('#signin-main svg')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/${route}-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}