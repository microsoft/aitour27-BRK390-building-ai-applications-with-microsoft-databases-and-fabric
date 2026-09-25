import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildProductionDecisionSignal,
  productionDecisionSignalCommand,
  publishProductionDecisionSignal,
  type DecisionSignalClient,
} from "./decision-signal-publisher.ts";
import { buildAct3Snapshot } from "./domain.ts";
import type { Act3Runtime } from "./runtime.ts";

const scenario = JSON.parse(
  await readFile(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const snapshot = {
  ...buildAct3Snapshot(scenario),
  source: {
    mode: "fabric" as const,
    sqlDatabase: "CaldovaOperational",
    eventhouseDatabase: "CaldovaSignals",
    retrievedAt: "2027-06-14T09:00:00.000Z",
  },
};

function queryResult(row?: Record<string, unknown>) {
  const columns = row
    ? Object.keys(row).map((name, ordinal) => ({ name, ordinal }))
    : [];
  return {
    primaryResults: [{
      columns,
      rows() {
        return row
          ? [{ getValueAt: (ordinal: number) => row[columns[ordinal].name] }]
          : [];
      },
    }],
  };
}

test("builds a flat recommendation signal only from Fabric-authoritative data", () => {
  assert.throws(
    () => buildProductionDecisionSignal(buildAct3Snapshot(scenario)),
    /Fabric-authoritative/,
  );

  const signal = buildProductionDecisionSignal(snapshot, new Date("2027-06-14T09:01:00Z"));
  assert.equal(signal.caseId, scenario.decisionCase.caseId);
  assert.equal(signal.recommendedOptionId, "OPT-4");
  assert.equal(signal.productionApproverRole, "ROLE-OPERATIONS-APPROVER");
  assert.equal(signal.maintenanceApproverRole, "ROLE-MAINTENANCE-APPROVER");
  assert.equal(signal.requiresDecision, true);
  assert.match(productionDecisionSignalCommand(signal), /^\.append ProductionDecisionSignals/);
});

test("publishes a changed decision and skips an unchanged decision", async () => {
  const commands: string[] = [];
  let latest: Record<string, unknown> | undefined;
  const client: DecisionSignalClient = {
    async executeQuery() { return queryResult(latest); },
    async executeMgmt(_database, command) { commands.push(command); },
  };
  const runtime: Act3Runtime = {
    authority: "fabric",
    async getSnapshot() { return snapshot; },
    async applyProductionPlan() { throw new Error("not used"); },
    async deferMaintenance() { throw new Error("not used"); },
  };

  const published = await publishProductionDecisionSignal(
    runtime,
    client,
    "CaldovaSignals",
    new Date("2027-06-14T09:01:00Z"),
  );
  assert.equal(published.status, "published");
  assert.equal(commands.length, 1);

  latest = {
    lineId: published.signal.lineId,
    maintenanceWindowId: published.signal.maintenanceWindowId,
    requiredIncrementalUnits: published.signal.requiredIncrementalUnits,
    headroomWithMaintenanceUnits: published.signal.headroomWithMaintenanceUnits,
    shortfallUnits: published.signal.shortfallUnits,
    recommendedOptionId: published.signal.recommendedOptionId,
    requiresDecision: published.signal.requiresDecision,
  };
  const unchanged = await publishProductionDecisionSignal(runtime, client, "CaldovaSignals");
  assert.equal(unchanged.status, "unchanged");
  assert.equal(commands.length, 1);
});
