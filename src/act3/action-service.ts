import { buildAct3Snapshot, requireApproval, type Approval } from "./domain.ts";

type ScenarioAction = {
  actionId: string;
  type: string;
  api: string;
  requestedAt: string;
  approvedAt: string;
  executedAt: string;
  approvedByRole: string;
  receiptId: string;
  status: string;
  result: string;
  details: Record<string, unknown>;
};

type Policy = {
  policyId: string;
  version: string;
  status: string;
  rule: Record<string, unknown>;
};

type Scenario = Parameters<typeof buildAct3Snapshot>[0] & {
  policies: Policy[];
  actions: ScenarioAction[];
};

export type ActionCommand = {
  actionId: string;
  correlationId: string;
  approval: Approval;
};

export type ActionReceipt = {
  receiptId: string;
  actionId: string;
  correlationId: string;
  issuedAt: string;
  approverRole: string;
  policyId: string;
  policyVersion: string;
  outcome: "success";
  details: Record<string, unknown>;
};

export interface ReceiptStore {
  findByActionId(actionId: string): Promise<ActionReceipt | undefined>;
  findByCorrelationId(correlationId: string): Promise<ActionReceipt | undefined>;
  save(receipt: ActionReceipt): Promise<void>;
}

export class InMemoryReceiptStore implements ReceiptStore {
  readonly receipts: ActionReceipt[] = [];

  async findByActionId(actionId: string): Promise<ActionReceipt | undefined> {
    return this.receipts.find((receipt) => receipt.actionId === actionId);
  }

  async findByCorrelationId(correlationId: string): Promise<ActionReceipt | undefined> {
    return this.receipts.find((receipt) => receipt.correlationId === correlationId);
  }

  async save(receipt: ActionReceipt): Promise<void> {
    this.receipts.push(receipt);
  }
}

export class GovernedActionService {
  readonly #scenario: Scenario;
  readonly #store: ReceiptStore;

  constructor(scenario: Scenario, store: ReceiptStore) {
    this.#scenario = scenario;
    this.#store = store;
  }

  async applyProductionPlan(command: ActionCommand): Promise<ActionReceipt> {
    const snapshot = buildAct3Snapshot(this.#scenario);
    const action = this.#getAction(command.actionId, "production_plan_change");
    requireApproval("production-plan-change", command.approval);
    this.#assertApprovalMatchesAction(command.approval, action);

    const option = snapshot.recommendedOption;
    this.#assertDetails(action, {
      lineId: snapshot.lineId,
      optionId: option.optionId,
      rateFactor: option.requiredRateFactor,
      utilisation: option.requiredUtilisation,
    });
    const policy = this.#getPolicy("POL-CAPACITY-003", "1.3");
    if (option.requiredUtilisation > Number(policy.rule.maxSustainedUtilisation)) {
      throw new Error("The production plan exceeds the approved sustained utilisation limit.");
    }
    if (option.requiredRateFactor > Number(policy.rule.maxSustainedRateFactor)) {
      throw new Error("The production plan exceeds the approved sustained rate limit.");
    }

    return this.#persist(command, action, policy);
  }

  async deferMaintenance(command: ActionCommand): Promise<ActionReceipt> {
    const snapshot = buildAct3Snapshot(this.#scenario);
    const action = this.#getAction(command.actionId, "maintenance_deferral");
    requireApproval("maintenance-deferral", command.approval);
    this.#assertApprovalMatchesAction(command.approval, action);

    this.#assertDetails(action, {
      maintenanceWindowId: snapshot.maintenanceWindowId,
      deferralDays: snapshot.deferralDays,
    });
    const policy = this.#getPolicy("POL-MAINT-002", "2.1");
    const deferralTable = policy.rule.deferralTable as Array<{
      maxSustainedRateFactor: number;
      maxDeferralDays: number;
    }>;
    const permittedDeferral = deferralTable.find(
      (entry) => snapshot.recommendedOption.requiredRateFactor <= entry.maxSustainedRateFactor,
    );
    if (!permittedDeferral || snapshot.deferralDays > permittedDeferral.maxDeferralDays) {
      throw new Error("The requested maintenance deferral exceeds the approved policy limit.");
    }
    if (snapshot.projectedStressPctOfThreshold > snapshot.stressCeilingPct) {
      throw new Error("The requested maintenance deferral exceeds the stress ceiling.");
    }

    return this.#persist(command, action, policy);
  }

  #getAction(actionId: string, expectedType: string): ScenarioAction {
    const action = this.#scenario.actions.find((candidate) => candidate.actionId === actionId);
    if (!action || action.type !== expectedType) {
      throw new Error(`Unknown ${expectedType} action ${actionId}.`);
    }
    return action;
  }

  #getPolicy(policyId: string, version: string): Policy {
    const policy = this.#scenario.policies.find(
      (candidate) => candidate.policyId === policyId && candidate.version === version,
    );
    if (!policy || policy.status !== "approved") {
      throw new Error(`Approved policy ${policyId}:${version} is required.`);
    }
    return policy;
  }

  #assertApprovalMatchesAction(approval: Approval, action: ScenarioAction): void {
    if (
      approval.role !== action.approvedByRole
      || Date.parse(approval.approvedAt) !== Date.parse(action.approvedAt)
    ) {
      throw new Error(`Approval does not match the governed action ${action.actionId}.`);
    }
  }

  #assertDetails(action: ScenarioAction, expected: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(expected)) {
      if (action.details[key] !== value) {
        throw new Error(`Action ${action.actionId} does not match scenario field ${key}.`);
      }
    }
  }

  async #persist(command: ActionCommand, action: ScenarioAction, policy: Policy): Promise<ActionReceipt> {
    if (!command.correlationId.trim()) {
      throw new Error("A correlationId is required.");
    }
    const existingAction = await this.#store.findByActionId(command.actionId);
    if (existingAction) {
      if (existingAction.correlationId !== command.correlationId) {
        throw new Error(`Action ${command.actionId} was already executed with another correlationId.`);
      }
      return existingAction;
    }
    const existingCorrelation = await this.#store.findByCorrelationId(command.correlationId);
    if (existingCorrelation) {
      throw new Error(`Correlation ${command.correlationId} is already bound to another action.`);
    }

    const receipt: ActionReceipt = {
      receiptId: action.receiptId,
      actionId: action.actionId,
      correlationId: command.correlationId,
      issuedAt: action.executedAt,
      approverRole: command.approval.role,
      policyId: policy.policyId,
      policyVersion: policy.version,
      outcome: "success",
      details: action.details,
    };
    await this.#store.save(receipt);
    return receipt;
  }
}