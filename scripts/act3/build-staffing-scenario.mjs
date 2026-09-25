import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {staffingDatasetContext} from '../../src/act3/staffing-dataset.ts';
import {validateStaffingMemory} from '../../src/act3/staffing.ts';

const source=readFileSync(new URL('../../data/scenario.json',import.meta.url));
const dataset=JSON.parse(source);
const extension=JSON.parse(readFileSync(new URL('../../src/act3/staffing-extension.json',import.meta.url)));
const linked=staffingDatasetContext(dataset);
const productionAction=dataset.actions.find(action=>action.type==='production_plan_change');
const supervisor=dataset.personas.find(person=>person.personaId===productionAction.approvedByPersonaId);
assert.ok(supervisor,'The production approver must exist in the shared persona registry.');
const ready=new Date(linked.windowStart);ready.setUTCDate(ready.getUTCDate()-1);
const year=new Date(linked.scenarioAsOf).getUTCFullYear();
assert.equal(extension.schemaVersion,3,'The staffing narrative requires the version 3 extension.');
const memoryId=`${linked.sourceCaseId}-staffing-v3`;
const caseId=`CASE-STAFFING-${linked.scenarioAsOf.slice(0,10).replaceAll('-','')}-V3`;
const sharedPolicy={policyVersion:'2.1',factoryId:linked.factoryId,validFrom:`${year}-01-01T00:00:00Z`,
  validUntil:`${year+1}-01-01T00:00:00Z`,status:'approved'};
const scenario={schemaVersion:3,dataClass:extension.dataClass,
  provenance:{narrative:'synthetic_colleague_narrative',extensionSchemaVersion:extension.schemaVersion,
    source:'src/act3/staffing-extension.json',originalDatasetUnchanged:true,
    description:'Owner-authorized fictional Act 2 reassignment and retained productivity lesson, followed by committed December demand and Southern Hemisphere summer holiday protection. Not an observed maintenance-deferral outcome.'},
  dataset:{sha256:createHash('sha256').update(source).digest('hex'),asOf:dataset.clock.asOf,
    sourceCaseId:linked.sourceCaseId,sourceDecisionAt:linked.sourceDecisionAt,sourceResolvedAt:dataset.decisionCase.resolvedAt,
    productId:linked.productId,productName:linked.productName,supervisor,operatingDates:linked.operatingDates,
    memoryStatus:extension.memoryStatus,assumptions:extension.assumptions},
  case:{caseId,title:`${linked.productName}: Southern Hemisphere summer staffing review`,factoryId:linked.factoryId,lineId:linked.lineId,
    scenarioAsOf:linked.scenarioAsOf,windowStart:linked.windowStart,windowEnd:linked.windowEnd,
    demandUnits:linked.dailyOutput*linked.productionDays+extension.demandAboveBaselineUnits,dailyOutput:linked.dailyOutput,
    baseWorkers:extension.baseWorkers,extraWorkers:extension.extraWorkers,gainPerWorker:extension.gainPerWorker,
    maxExtraWorkers:extension.maxExtraWorkers,machineDailyLimit:linked.machineDailyLimit,
    temporaryAvailable:extension.temporaryAvailable,qualified:extension.qualified,onboardingReadyAt:ready.toISOString(),
    modelVersion:extension.modelVersion,memoryId,memoryPartition:linked.sourceCaseId,
    operatingDates:linked.operatingDates,datasetContext:{sourceHash:createHash('sha256').update(source).digest('hex'),
      productId:linked.productId,productName:linked.productName,sourceCaseId:linked.sourceCaseId,sourceDecisionAt:linked.sourceDecisionAt}},
  policies:[{...sharedPolicy,policyId:'POL-SHIFT-NOTICE',lineId:null,title:'Published shift protection',
    body:`Existing employees require ${extension.noticeDays} days of notice before published shift or line-assignment changes. Qualified temporary assignments on unchanged shifts are evaluated under the separate temporary staffing policy.`,
    ruleType:'schedule_notice',noticeDays:extension.noticeDays,allowNewAssignments:null},
    {...sharedPolicy,policyId:'POL-TEMP-PACKING',lineId:linked.lineId,title:'Qualified temporary packing assignments',
      body:'Qualified temporary packers may join unchanged shifts when availability and onboarding are confirmed before production. Staffing must stay inside the line-specific model and production ceiling. Operations and HR must approve the same current plan.',
      ruleType:'temporary_staffing',noticeDays:null,allowNewAssignments:true}],
  rehearsalMemory:{schemaVersion:3,dataClass:'synthetic_colleague_narrative',
    id:memoryId,caseId:linked.sourceCaseId,recordedAt:dataset.decisionCase.resolvedAt,
    author:supervisor.displayName,lesson:extension.packingObservation,
    priorAction:extension.priorAction,workforcePriority:extension.workforcePriority,
    productivity:{gainPerWorker:extension.gainPerWorker,maxExtraWorkers:extension.maxExtraWorkers},
    lineId:linked.lineId,bottleneck:'end-of-line-packing',modelVersion:extension.modelVersion},
  expected:{productionDays:linked.productionDays,baselineUnits:linked.dailyOutput*linked.productionDays,
    shortfallUnits:extension.demandAboveBaselineUnits,
    staffedUnits:Math.floor(Math.min(linked.dailyOutput*(1+extension.extraWorkers*extension.gainPerWorker),linked.machineDailyLimit))*linked.productionDays}
};
assert.ok(scenario.rehearsalMemory.author,'A named supervisor is required.');
validateStaffingMemory(scenario.rehearsalMemory);
assert.ok(scenario.expected.staffedUnits>=scenario.case.demandUnits);
const output=JSON.stringify(scenario,null,2)+'\n';
const target=new URL('../../src/act3/staffing-scenario.json',import.meta.url);
if(process.argv.includes('--check'))assert.equal(readFileSync(target,'utf8'),output,'Rebuild the staffing scenario after shared dataset changes.');
else writeFileSync(target,output);
console.log(JSON.stringify({caseId,sourceCaseId:linked.sourceCaseId,planning:linked.scenarioAsOf,...scenario.expected}));