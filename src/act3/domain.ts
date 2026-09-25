export type ActionKind = "production-plan-change" | "maintenance-deferral";

export type Approval = {
  role: string;
  approvedAt: string;
};

export type ProductionOption = {
  optionId: string;
  name: string;
  requiredRateFactor: number;
  requiredUtilisation: number;
  incrementalUnitsDelivered: number;
  shortfallUnits: number;
  effectOnExistingOrders: string;
  policyCompliant: boolean;
  recommended?: boolean;
  secondaryApproverRole?: string;
};

export type LiveLineTelemetry = {
  observedAt: string;
  actualRateUnitsPerMin: number;
  rateFactor: number;
  utilisation: number;
  cumulativeStressIndex: number;
  state: string;
};

export type SnapshotSource = {
  mode: "fixture" | "fabric";
  sqlDatabase?: string;
  eventhouseDatabase?: string;
  retrievedAt: string;
};

type Scenario = {
  decisionCase: {
    caseId: string;
  };
  capacityModel: {
    expected: {
      capacityWithoutMaintenanceUnits: number;
      capacityWithMaintenanceUnits: number;
      headroomWithMaintenanceUnits: number;
      requiredIncrementalUnits: number;
      shortfallUnits: number;
    };
  };
  maintenance: {
    maintenanceWindowId: string;
    lineId: string;
    deferralDays: number;
  };
  stressModel: {
    projectedStressPctOfThreshold: number;
    stressCeilingPct: number;
    withinCeiling: boolean;
  };
  options: ProductionOption[];
  recommendedOptionId: string;
};

export type Act3Snapshot = {
  caseId: string;
  lineId: string;
  maintenanceWindowId: string;
  capacityWithoutMaintenanceUnits: number;
  capacityWithMaintenanceUnits: number;
  headroomWithMaintenanceUnits: number;
  requiredIncrementalUnits: number;
  shortfallUnits: number;
  deferralDays: number;
  projectedStressPctOfThreshold: number;
  stressCeilingPct: number;
  recommendedOption: ProductionOption;
  options: ProductionOption[];
  telemetry?: LiveLineTelemetry;
  source?: SnapshotSource;
};

const REQUIRED_ROLES: Record<ActionKind, string> = {
  "production-plan-change": "ROLE-OPERATIONS-APPROVER",
  "maintenance-deferral": "ROLE-MAINTENANCE-APPROVER",
};

export function buildAct3Snapshot(scenario: Scenario): Act3Snapshot {
  const recommendedOption = scenario.options.find(
    (option) => option.optionId === scenario.recommendedOptionId,
  );
  if (!recommendedOption?.recommended || !recommendedOption.policyCompliant) {
    throw new Error("The recommended production option must be present, recommended, and policy compliant.");
  }
  if (!scenario.stressModel.withinCeiling) {
    throw new Error("The recommended production option exceeds the maintenance stress ceiling.");
  }

  return {
    caseId: scenario.decisionCase.caseId,
    lineId: scenario.maintenance.lineId,
    maintenanceWindowId: scenario.maintenance.maintenanceWindowId,
    ...scenario.capacityModel.expected,
    deferralDays: scenario.maintenance.deferralDays,
    projectedStressPctOfThreshold: scenario.stressModel.projectedStressPctOfThreshold,
    stressCeilingPct: scenario.stressModel.stressCeilingPct,
    recommendedOption,
    options: scenario.options,
  };
}

export function requireApproval(kind: ActionKind, approval: Approval | undefined): Approval {
  const requiredRole = REQUIRED_ROLES[kind];
  if (!approval) {
    throw new Error(`${kind} requires approval from ${requiredRole}.`);
  }
  if (approval.role !== requiredRole) {
    throw new Error(`${kind} requires ${requiredRole}; received ${approval.role}.`);
  }
  if (!Number.isFinite(Date.parse(approval.approvedAt))) {
    throw new Error("Approval must include a valid approvedAt timestamp.");
  }
  return approval;
}