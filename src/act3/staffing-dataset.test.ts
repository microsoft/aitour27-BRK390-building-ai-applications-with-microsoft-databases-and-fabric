import assert from 'node:assert/strict';
import test from 'node:test';
import dataset from '../../data/scenario.json' with {type:'json'};
import {staffingDatasetContext} from './staffing-dataset.ts';
import scenario from './staffing-scenario.json' with {type:'json'};
import extension from './staffing-extension.json' with {type:'json'};
import {memoryApplies,validateStaffingMemory} from './staffing.ts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

test('staffing derives its date, identities and operating calendar from the shared dataset',()=>{
  const result=staffingDatasetContext(dataset);
  assert.equal(result.sourceCaseId,dataset.decisionCase.caseId);
  assert.equal(result.factoryId,'PLANT-02');
  assert.equal(result.scenarioAsOf,'2026-12-10T09:00:00.000Z');
  assert.equal(result.dailyOutput,17280);
  assert.equal(result.productionDays,12);
  assert.ok(result.operatingDates.every(date=>new Date(date).getUTCDay()!==0));
});

test('a calendar move propagates without editing staffing dates',()=>{
  const shifted=structuredClone(dataset);
  shifted.clock.productionApprovedAt='2027-10-31T09:05:00Z';
  assert.equal(staffingDatasetContext(shifted).scenarioAsOf,'2028-02-29T09:00:00.000Z');
});

test('version 3 keeps December capacity and authors a separate colleague lesson without changing the original dataset',()=>{
  assert.equal(scenario.schemaVersion,3);
  assert.equal(scenario.case.caseId,'CASE-STAFFING-20261210-V3');
  assert.equal(scenario.case.memoryId,`${dataset.decisionCase.caseId}-staffing-v3`);
  assert.equal(scenario.rehearsalMemory.id,scenario.case.memoryId);
  assert.equal(scenario.rehearsalMemory.caseId,scenario.case.memoryPartition);
  assert.equal(scenario.rehearsalMemory.priorAction,extension.priorAction);
  assert.match(scenario.rehearsalMemory.priorAction,/reassigned/);
  assert.doesNotMatch(scenario.rehearsalMemory.priorAction,/maintenance|deferral/i);
  assert.equal(scenario.rehearsalMemory.workforcePriority,extension.workforcePriority);
  assert.deepEqual(scenario.rehearsalMemory.productivity,{gainPerWorker:0.08,maxExtraWorkers:2});
  assert.equal(memoryApplies(validateStaffingMemory(scenario.rehearsalMemory),scenario.case),true);
  assert.equal(scenario.provenance.narrative,'synthetic_colleague_narrative');
  assert.match(scenario.provenance.description,/Southern Hemisphere summer holiday/);
  assert.equal(scenario.dataset.sha256,createHash('sha256').update(readFileSync(new URL('../../data/scenario.json',import.meta.url))).digest('hex'));
  assert.deepEqual(scenario.expected,{productionDays:12,baselineUnits:207360,shortfallUnits:20000,staffedUnits:233280});
  assert.equal(scenario.case.scenarioAsOf,'2026-12-10T09:00:00.000Z');
  assert.equal(scenario.policies.find(policy=>policy.ruleType==='schedule_notice')?.noticeDays,21);
});