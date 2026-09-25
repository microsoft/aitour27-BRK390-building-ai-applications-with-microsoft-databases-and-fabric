import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync(new URL('../../src/act3/staffing-scenario.json', import.meta.url)));

async function fixture(page, { memoryFails = false, approvalFails = false } = {}) {
  const calls = [];
  const snapshot = { ...scenario.case, state: 'review', contextHash: 'a'.repeat(64), planningNow: scenario.case.scenarioAsOf,
    datasetContext: JSON.stringify(scenario.case.datasetContext), operatingDates: JSON.stringify(scenario.case.operatingDates),
    actor: { roles: ['ROLE-ACT3-READER', 'ROLE-OPERATIONS-APPROVER', 'ROLE-HR-APPROVER'] }, approvals: [], plan: null,
    options: [
      { optionId: 'unchanged', optionName: 'Keep current staffing', addedWorkers: 0, outputUnits: scenario.expected.baselineUnits, shortfallUnits: scenario.expected.shortfallUnits, eligible: false, reason: 'Shortfall' },
      { optionId: 'temporary', optionName: 'Add temporary staff', addedWorkers: 2, outputUnits: scenario.expected.staffedUnits, shortfallUnits: 0, eligible: true, reason: 'Eligible' },
    ] };
  await page.route('**/api/assets/msal.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.msal = { InteractionRequiredAuthError: class extends Error {}, PublicClientApplication: class {
      async initialize() {} async handleRedirectPromise() { return null; }
      getAllAccounts() { return [{}]; } setActiveAccount() {} getActiveAccount() { return {}; }
      async acquireTokenSilent() { return {accessToken:'test-only-token'}; }
    }};` }));
  await page.route('**/api/staffing/*', async route => {
    const request = route.request();
    const action = new URL(request.url()).pathname.split('/').pop();
    const body = request.postDataJSON();
    calls.push({ action, body });
    expect(request.headers().authorization).toBe('Bearer test-only-token');
    let result;
    let status = 200;
    if (action === 'snapshot') result = snapshot;
    else if (action === 'assess') {
      status = memoryFails ? 503 : 200;
      result = memoryFails ? { error: 'Private dependency detail', dependency: 'cosmos', writeOutcomeUnknown: false } : {
        snapshot,
        memory: {
          ...scenario.rehearsalMemory, memory: scenario.rehearsalMemory, applicable: true, mode: 'cosmos', hash: 'b'.repeat(64),
          finding: '<img src=x onerror="window.injected=true">', priorAction: scenario.rehearsalMemory.priorAction,
          productivity: scenario.rehearsalMemory.productivity, workforcePriority: scenario.rehearsalMemory.workforcePriority,
          source: 'test-source',
        },
        policies: {
          question: body.question,
          matches: [{ title: '<script>window.injected=true</script>', body: 'Reviewed policy', policyId: 'TEST', policyVersion: '1', distance: 0.1 }],
        },
      };
    }
    else if (action === 'propose') { snapshot.state = 'awaiting_approval'; result = { state: snapshot.state }; }
    else if (action === 'approve') {
      if (approvalFails) { status = 503; result = { error: 'Write outcome unknown; inspect receipts.', writeOutcomeUnknown: true }; }
      else {
        const receipt = { ...body, actorId: '00000000-0000-0000-0000-000000000006', approvedAt: '2026-09-13T12:00:00Z' };
        snapshot.approvals.push(receipt);
        if (snapshot.approvals.length === 2) { snapshot.state = 'authorized'; snapshot.plan = { recordedAt: receipt.approvedAt, outputUnits: scenario.expected.staffedUnits }; }
        result = receipt;
      }
    } else throw new Error(`Unexpected test action: ${action}`);
    await route.fulfill({ status, json: result });
  });
  await page.goto('/api/staffing-app');
  await expect(page.locator('#signedin')).toBeVisible();
  return calls;
}

test('staffing UI reviews sources, escapes text and displays two explicit approval receipts (mock boundaries)', async ({ page }) => {
  const calls = await fixture(page);
  await expect(page.locator('#propose')).toBeDisabled();
  await page.getByRole('button', { name: 'Assess staffing' }).click();
  await expect(page.locator('#propose')).toBeEnabled();
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.locator('#policy-results script')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Approvals' }).click();
  await expect(page.locator('#propose')).toBeVisible();
  await page.locator('#propose').click();
  await expect(page.locator('#approve-operations')).toBeEnabled();
  await page.locator('#approve-operations').click();
  await expect(page.locator('#approve-operations')).toBeDisabled();
  await page.locator('#approve-hr').click();
  await expect(page.locator('#case-status')).toHaveText('authorized');
  await expect(page.locator('#receipts article')).toHaveCount(2);
  expect(calls.filter(call => call.action === 'approve')).toHaveLength(2);
});

test('missing retained source keeps proposal disabled (mock boundary)', async ({ page }) => {
  const calls = await fixture(page, { memoryFails: true });
  await page.getByRole('button', { name: 'Assess staffing' }).click();
  await expect(page.locator('#message')).toHaveText('The retained decision could not be verified. Retry assessment before submitting a plan.');
  await expect(page.locator('#propose')).toBeDisabled();
  expect(calls.some(call => ['propose', 'approve'].includes(call.action))).toBe(false);
});

test('uncertain approval is not replayed and retains its id (mock boundary)', async ({ page }) => {
  const calls = await fixture(page, { approvalFails: true });
  await page.getByRole('button', { name: 'Assess staffing' }).click();
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Approvals' }).click();
  await page.locator('#propose').click();
  await page.locator('#approve-operations').click();
  await expect(page.locator('#message')).toHaveText(
    'The write outcome could not be confirmed. Refresh and inspect approval receipts, then assess staffing again before retrying.',
  );
  expect(calls.filter(call => call.action === 'approve')).toHaveLength(1);
  const pending = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('staffing-approval-')).map(key => JSON.parse(sessionStorage[key])));
  expect(pending).toHaveLength(1);
  expect(pending[0].requestId).toBe(calls.find(call => call.action === 'approve').body.requestId);
});