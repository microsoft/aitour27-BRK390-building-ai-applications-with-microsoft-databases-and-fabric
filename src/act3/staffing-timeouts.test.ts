import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./web/staffing.js', import.meta.url), 'utf8');
const requestSource = source.slice(source.indexOf('async function jsonRequest('), source.indexOf('async function api('));
const approvalSource = source.slice(source.indexOf('async function approve('), source.indexOf('function openInspector('));

test('staffing request permits bounded SQL recovery and aborts stalled response bodies', async () => {
  let deadline = 0;
  let expire: () => void = () => {};
  const request = runInNewContext(`${requestSource}\njsonRequest`, {
    AbortController,
    setTimeout(callback: () => void, milliseconds: number) { deadline = milliseconds; expire = callback; return 1; },
    clearTimeout() {},
    fetch: async (_url: string, options: RequestInit) => ({ ok: true,
      json: () => new Promise((_resolve, reject) => {
        if (options.signal?.aborted) reject(new Error('Aborted'));
        else options.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      }) }),
  });
  const pending = request('/api/staffing/approve', { method: 'POST' });
  await Promise.resolve();
  assert.equal(deadline, 90_000);
  expire();
  await assert.rejects(pending, (error: { writeOutcomeUnknown?: boolean }) => error.writeOutcomeUnknown === true);
});

test('staffing approval retains its id after an uncertain write and never replays automatically', async () => {
  const stored = new Map<string, string>();
  const requests: unknown[] = [];
  const approve = runInNewContext(`${approvalSource}\napprove`, {
    current: { caseId: 'TEST-CASE', contextHash: 'a'.repeat(64) }, memory: { hash: 'b'.repeat(64) },
    crypto: { randomUUID: () => '00000000-0000-0000-0000-000000000004' },
    sessionStorage: { getItem: (key: string) => stored.get(key), setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
    api: async (_action: string, body: unknown) => { requests.push(body); throw Object.assign(new Error('Unknown write outcome'), { writeOutcomeUnknown: true }); },
  });
  await assert.rejects(approve('ROLE-HR-APPROVER'));
  assert.equal(requests.length, 1);
  assert.equal(stored.size, 1);
  await assert.rejects(approve('ROLE-HR-APPROVER'));
  assert.deepEqual(requests[0], requests[1]);
});