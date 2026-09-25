import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {prepareStaffingSession, sessionCaseId} from './prepare-staffing-session.mjs';

function fixture({existing = false, expired = false, eligible = true, reassignmentEligible = false} = {}) {
  const calls = [];
  const transaction = new EventEmitter();
  transaction.begin = async () => calls.push('begin');
  transaction.commit = async () => calls.push('commit');
  transaction.rollback = async () => { calls.push('rollback'); transaction.emit('rollback'); };
  const caseId = 'SESSION-regression';
  const current = {caseId, state: 'review', scenarioAsOf: '2026-12-10T09:00:00Z',
    planningNow: expired ? '2026-12-14T09:00:00Z' : '2026-12-10T09:00:01Z',
    windowStart: '2026-12-13T06:00:00Z'};
  const options = [
    {optionId: 'unchanged', eligible: false},
    {optionId: 'reassign', eligible: reassignmentEligible, requiredNoticeDays: 21,
      reason: 'Changing published shifts would breach the minimum notice period.'},
    {optionId: 'temporary', eligible},
  ];
  const request = () => ({
    input(name, type, value) { assert.equal(name, 'caseId'); assert.equal(value, caseId); return this; },
    async query(query) {
      calls.push(query);
      if (query.includes('WITH(UPDLOCK,HOLDLOCK)')) return {recordset: existing ? [{caseId}] : []};
      return {recordsets: [[current], options, [{approvals: 0, plans: 0}]]};
    },
  });
  const insertCase = async (pool, id) => { assert.equal(pool.request, request); assert.equal(id, caseId); calls.push('insert'); };
  return {calls, run: () => prepareStaffingSession({}, caseId, insertCase, {transaction, request})};
}

test('fresh isolated case commits only after SQL confirms temporary staffing and both blocked alternatives', async () => {
  const {calls, run} = fixture();
  const result = await run();
  assert.equal(result.case.caseId, 'SESSION-regression');
  assert.equal(result.options.find(option => option.optionId === 'reassign').requiredNoticeDays, 21);
  assert.equal(calls.at(-1), 'commit');
  assert.ok(calls.indexOf('insert') > 0);
  assert.ok(calls.some(call => call.includes('staffing.options(@caseId)')));
});

test('expired production window rolls back the new case', async () => {
  const {calls, run} = fixture({expired: true, eligible: false});
  await assert.rejects(run, /production window has already started/);
  assert.equal(calls.at(-1), 'rollback');
  assert.ok(!calls.includes('commit'));
});

test('missing policy, qualification or availability reported by SQL fails closed', async () => {
  const {calls, run} = fixture({eligible: false});
  await assert.rejects(run, /not compliant/);
  assert.equal(calls.at(-1), 'rollback');
});

test('an unexpectedly eligible reassignment cannot silently weaken the demo constraints', async () => {
  const {calls, run} = fixture({reassignmentEligible: true});
  await assert.rejects(run, /Reassignment must remain blocked/);
  assert.equal(calls.at(-1), 'rollback');
});

test('existing session is rejected before insertion, preserving its state and receipts', async () => {
  const {calls, run} = fixture({existing: true});
  await assert.rejects(run, /already exists/);
  assert.ok(!calls.includes('insert'));
  assert.equal(calls.at(-1), 'rollback');
});

test('original case IDs and unsafe or oversized identifiers cannot be prepared', () => {
  for (const id of ['CASE-STAFFING-20261210-V3', '', 'SESSION-x\'; DROP TABLE staffing.cases;', 'SESSION-' + 'x'.repeat(81)]) {
    assert.throws(() => sessionCaseId(id));
  }
  assert.equal(sessionCaseId('REHEARSAL-fresh_1'), 'REHEARSAL-fresh_1');
});