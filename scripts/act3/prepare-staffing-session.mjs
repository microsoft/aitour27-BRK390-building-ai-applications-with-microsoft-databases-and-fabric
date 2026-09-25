import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import sql from 'mssql';

export function sessionCaseId(value) {
  assert.match(value || '', /^(?:SESSION|REHEARSAL)-[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/,
    'Use a new SESSION- or REHEARSAL- case ID (at most 90 characters).');
  return value;
}

export async function prepareStaffingSession(pool, caseId, insertCase, adapters = {}) {
  sessionCaseId(caseId);
  const transaction = adapters.transaction || new sql.Transaction(pool);
  const request = adapters.request || (() => new sql.Request(transaction));
  let rolledBack = false;
  transaction.on('rollback', () => { rolledBack = true; });
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const existing = await request().input('caseId', sql.NVarChar(100), caseId).query(
      'SELECT caseId FROM staffing.cases WITH(UPDLOCK,HOLDLOCK) WHERE caseId=@caseId;');
    assert.equal(existing.recordset.length, 0,
      'This session ID already exists. Inspect it before using a new ID; existing cases and receipts are preserved.');
    await insertCase({request}, caseId);
    const result = await request().input('caseId', sql.NVarChar(100), caseId).query(`
      SELECT caseId,scenarioAsOf,planningNow,clockStartedAt,windowStart,windowEnd,state
        FROM staffing.current_cases WHERE caseId=@caseId;
      SELECT optionId,outputUnits,shortfallUnits,requiredNoticeDays,eligible,reason
        FROM staffing.options(@caseId);
      SELECT (SELECT COUNT(*) FROM staffing.approvals WHERE caseId=@caseId) AS approvals,
        (SELECT COUNT(*) FROM staffing.plans WHERE caseId=@caseId) AS plans;`);
    const current = result.recordsets[0][0];
    const options = result.recordsets[1];
    assert.ok(current && current.caseId === caseId && current.state === 'review', 'A new case must be awaiting review.');
    assert.ok(new Date(current.planningNow) >= new Date(current.scenarioAsOf)
      && new Date(current.planningNow) < new Date(current.windowStart), 'The session production window has already started.');
    assert.equal(options.length, 3, 'Expected all three staffing options.');
    assert.equal(options.find(option => option.optionId === 'temporary')?.eligible, true,
      'Temporary staffing is not compliant with current SQL policy and availability. No session was retained.');
    assert.equal(options.find(option => option.optionId === 'unchanged')?.eligible, false, 'The baseline must remain insufficient.');
    const reassignment = options.find(option => option.optionId === 'reassign');
    assert.equal(reassignment?.eligible, false, 'Reassignment must remain blocked.');
    assert.match(reassignment.reason, /notice period/, 'The existing notice rule must remain in force.');
    assert.deepEqual(result.recordsets[2][0], {approvals: 0, plans: 0}, 'A new session must have no approvals or plan.');
    await transaction.commit();
    return {case: current, options};
  } catch (error) {
    if (!rolledBack) await transaction.rollback();
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length >= 2 && args.length <= 3 && args[0] === '--case-id'
    && (args.length === 2 || args[2] === '--write'),
  'Usage: node --env-file=.env scripts/act3/prepare-staffing-session.mjs --case-id SESSION-unique-id [--write]');
  const caseId = sessionCaseId(args[1]);
  execFileSync(process.execPath, [new URL('./build-staffing-scenario.mjs', import.meta.url).pathname, '--check'], {stdio: 'pipe'});
  const scenario = JSON.parse(readFileSync(new URL('../../src/act3/staffing-scenario.json', import.meta.url)));
  if (!args.includes('--write')) {
    console.log(JSON.stringify({mode: 'preview', caseId, scenarioAsOf: scenario.case.scenarioAsOf,
      windowStart: scenario.case.windowStart, windowEnd: scenario.case.windowEnd,
      message: 'No cloud access. A new case starts its own SQL planning clock at scenarioAsOf. --write checks live SQL eligibility before committing. No policies, sources, existing cases or app settings are changed.'}, null, 2));
    return;
  }
  const {connect, insertCase} = await import('./staffing-admin.mjs');
  const pool = await connect();
  try {
    const result = await prepareStaffingSession(pool, caseId, insertCase);
    console.log(JSON.stringify({...result, selection: {ACT3_STAFFING_CASE_ID: caseId},
      message: 'Case prepared only. Select it through the approved Function settings process. Normal authentication and Cosmos retrieval still apply.'}, null, 2));
  } finally {
    await pool.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof assert.AssertionError ? error.message
      : 'Session preparation failed or its outcome is uncertain. Inspect the requested case ID before retrying.');
    process.exitCode = 1;
  });
}