import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GovernedActionService, InMemoryReceiptStore } from "./action-service.ts";

const scenario = JSON.parse(
  await readFile(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const productionAction = scenario.actions.find((action: {actionId: string}) => action.actionId === "ACT-PROD-002");
const maintenanceAction = scenario.actions.find((action: {actionId: string}) => action.actionId === "ACT-MAINT-003");

test("executes OPT-4 as two approved, correlated actions with retained receipts", async () => {
  const store = new InMemoryReceiptStore();
  const service = new GovernedActionService(scenario, store);
  const correlationId = `${scenario.decisionCase.caseId}/OPT-4`;

  const production = await service.applyProductionPlan({
    actionId: "ACT-PROD-002",
    correlationId,
    approval: {
      role: "ROLE-OPERATIONS-APPROVER",
      approvedAt: productionAction.approvedAt,
    },
  });
  const maintenance = await service.deferMaintenance({
    actionId: "ACT-MAINT-003",
    correlationId: `${correlationId}/maintenance`,
    approval: {
      role: "ROLE-MAINTENANCE-APPROVER",
      approvedAt: maintenanceAction.approvedAt,
    },
  });

  assert.equal(production.receiptId, productionAction.receiptId);
  assert.equal(production.policyId, "POL-CAPACITY-003");
  assert.equal(maintenance.receiptId, maintenanceAction.receiptId);
  assert.equal(maintenance.policyId, "POL-MAINT-002");
  assert.equal(store.receipts.length, 2);
});

test("returns the retained receipt for an identical retry", async () => {
  const store = new InMemoryReceiptStore();
  const service = new GovernedActionService(scenario, store);
  const command = {
    actionId: "ACT-PROD-002",
    correlationId: `${scenario.decisionCase.caseId}/OPT-4`,
    approval: {
      role: "ROLE-OPERATIONS-APPROVER",
      approvedAt: productionAction.approvedAt,
    },
  };

  const first = await service.applyProductionPlan(command);
  const retry = await service.applyProductionPlan(command);

  assert.deepEqual(retry, first);
  assert.equal(store.receipts.length, 1);
});

test("does not persist a receipt when approval is absent or invalid", async () => {
  const store = new InMemoryReceiptStore();
  const service = new GovernedActionService(scenario, store);

  await assert.rejects(
    service.deferMaintenance({
      actionId: "ACT-MAINT-003",
      correlationId: `${scenario.decisionCase.caseId}/OPT-4/maintenance`,
      approval: {
        role: "ROLE-OPERATIONS-APPROVER",
        approvedAt: maintenanceAction.approvedAt,
      },
    }),
    /ROLE-MAINTENANCE-APPROVER/,
  );
  assert.equal(store.receipts.length, 0);
});