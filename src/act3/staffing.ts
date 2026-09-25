export const STAFFING_ROLES = ['ROLE-OPERATIONS-APPROVER', 'ROLE-HR-APPROVER'] as const;

export type StaffingMemory = {
  schemaVersion: 3;
  dataClass: 'synthetic_colleague_narrative';
  id: string;
  caseId: string;
  recordedAt: string;
  author: string;
  lesson: string;
  priorAction: string;
  lineId: string;
  bottleneck: 'end-of-line-packing';
  modelVersion: string;
  productivity: {gainPerWorker: number; maxExtraWorkers: number};
  workforcePriority: string;
};

type CurrentStaffingModel = {lineId: string; modelVersion: string; gainPerWorker: number; maxExtraWorkers: number};

function validProductivity(value: unknown): value is StaffingMemory['productivity'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const productivity = value as Record<string, unknown>;
  return typeof productivity.gainPerWorker === 'number' && Number.isFinite(productivity.gainPerWorker)
    && productivity.gainPerWorker > 0 && productivity.gainPerWorker <= 1
    && typeof productivity.maxExtraWorkers === 'number' && Number.isSafeInteger(productivity.maxExtraWorkers)
    && productivity.maxExtraWorkers > 0;
}

export function validateStaffingMemory(value: unknown): StaffingMemory {
  if (!value || typeof value !== 'object') throw new Error('The retained decision is unavailable.');
  const memory = value as Record<string, unknown>;
  for (const key of ['id', 'caseId', 'recordedAt', 'author', 'lesson', 'priorAction', 'lineId', 'modelVersion', 'workforcePriority']) {
    if (typeof memory[key] !== 'string' || !memory[key].trim() || memory[key].length > 4000) {
      throw new Error('The retained decision is missing its source or operational context.');
    }
  }
  if (!Number.isFinite(Date.parse(memory.recordedAt as string)) || memory.bottleneck !== 'end-of-line-packing') {
    throw new Error('The retained decision does not establish the packaging bottleneck.');
  }
  if (memory.schemaVersion !== 3 || memory.dataClass !== 'synthetic_colleague_narrative' || !validProductivity(memory.productivity)) {
    throw new Error('The retained decision is missing its versioned productivity lesson.');
  }
  const validated = memory as StaffingMemory;
  return {schemaVersion:3,dataClass:'synthetic_colleague_narrative',id:validated.id,caseId:validated.caseId,
    recordedAt:validated.recordedAt,author:validated.author,lesson:validated.lesson,priorAction:validated.priorAction,
    lineId:validated.lineId,bottleneck:validated.bottleneck,modelVersion:validated.modelVersion,
    productivity:{gainPerWorker:validated.productivity.gainPerWorker,maxExtraWorkers:validated.productivity.maxExtraWorkers},
    workforcePriority:validated.workforcePriority};
}

export function memoryApplies(memory: StaffingMemory, current: CurrentStaffingModel): boolean {
  return validProductivity(memory.productivity) && validProductivity(current)
    && memory.schemaVersion === 3 && memory.dataClass === 'synthetic_colleague_narrative'
    && typeof memory.workforcePriority === 'string' && memory.workforcePriority.trim().length > 0
    && memory.lineId === current.lineId && memory.modelVersion === current.modelVersion
    && memory.productivity.gainPerWorker === current.gainPerWorker
    && memory.productivity.maxExtraWorkers === current.maxExtraWorkers;
}

export function staffingNarrative(memory: StaffingMemory, current: CurrentStaffingModel) {
  const applicable = memoryApplies(memory, current);
  return {
    applicable,
    sourceCaseId: memory.caseId,
    finding: memory.lesson,
    priorAction: memory.priorAction,
    productivity: memory.productivity,
    workforcePriority: memory.workforcePriority,
    nextStep: applicable
      ? 'Evaluate additional end-of-line packing staff against the current roster, capacity model and approved policies.'
      : 'The retained productivity lesson does not match the current line and SQL staffing model. Review the source before assessing or proposing staffing.',
  };
}