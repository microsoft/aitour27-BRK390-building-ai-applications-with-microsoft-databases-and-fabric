import assert from 'node:assert/strict';
import test from 'node:test';
import {memoryApplies, staffingNarrative, validateStaffingMemory} from './staffing.ts';

const retained = {
  schemaVersion:3, dataClass:'synthetic_colleague_narrative',
  id:'packing-insight', caseId:'CASE-NORTH-SUMMER', recordedAt:'2026-06-01T09:00:00Z',
  author:'Karin Blair', lesson:'End-of-line packing is people-bound on this line.',
  priorAction:'Reassign qualified packers with sufficient schedule notice.',
  lineId:'PKG-02', bottleneck:'end-of-line-packing', modelVersion:'packing-v1',
  productivity:{gainPerWorker:0.08,maxExtraWorkers:2}, workforcePriority:'Protect published summer holidays.',
};
const current = {lineId:'PKG-02',modelVersion:'packing-v1',gainPerWorker:0.08,maxExtraWorkers:2};

test('retained expertise identifies the lever but does not authorize a staffing change', () => {
  const memory = validateStaffingMemory(retained);
  const result = staffingNarrative(memory, current);
  assert.equal(result.applicable, true);
  assert.match(result.nextStep, /current roster, capacity model and approved policies/);
  assert.equal('authorized' in result, false);
});

test('memory from another line or model cannot justify the current staffing proposal', () => {
  const memory = validateStaffingMemory(retained);
  assert.equal(memoryApplies(memory, {...current,lineId:'PKG-03'}), false);
  assert.equal(staffingNarrative(memory, {...current,modelVersion:'packing-v2'}).applicable, false);
});

test('missing, unsupported or unattributed memory fails closed', () => {
  for (const value of [null, {}, {...retained,author:''}, {...retained,bottleneck:'machine-speed'}, {...retained,recordedAt:'unknown'},
    {...retained,schemaVersion:2}, {...retained,workforcePriority:''}, {...retained,productivity:undefined}]) {
    assert.throws(() => validateStaffingMemory(value));
  }
});

test('productivity must be finite, typed, bounded and identical to the current SQL model', () => {
  const memory = validateStaffingMemory(retained);
  for (const gainPerWorker of [NaN, Infinity, -0.08, 0, 1.01, '0.08', null]) {
    assert.throws(() => validateStaffingMemory({...retained,productivity:{...retained.productivity,gainPerWorker}}));
    assert.equal(memoryApplies(memory, {...current,gainPerWorker} as typeof current), false);
  }
  for (const maxExtraWorkers of [NaN, Infinity, -2, 0, 1.5, Number.MAX_SAFE_INTEGER+1, '2', null]) {
    assert.throws(() => validateStaffingMemory({...retained,productivity:{...retained.productivity,maxExtraWorkers}}));
    assert.equal(memoryApplies(memory, {...current,maxExtraWorkers} as typeof current), false);
  }
  assert.equal(memoryApplies(memory, {...current,gainPerWorker:0.09}), false);
  assert.equal(memoryApplies(memory, {...current,maxExtraWorkers:3}), false);
  assert.equal(memoryApplies({...memory,productivity:undefined} as unknown as typeof memory,current), false);
});

test('validated memory retains the narrative but cannot add governing policy fields', () => {
  const memory = validateStaffingMemory({...retained,noticeDays:0,allowNewAssignments:true});
  assert.deepEqual(memory.productivity,retained.productivity);
  assert.equal(memory.workforcePriority,retained.workforcePriority);
  assert.equal('noticeDays' in memory,false);
  assert.equal('allowNewAssignments' in memory,false);
});