import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAct3Snapshot, requireApproval } from "./domain.ts";

const scenario = JSON.parse(
  await readFile(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);

test("derives the Demo 3 conflict and recommendation from the frozen scenario", () => {
  const snapshot = buildAct3Snapshot(scenario);

  assert.equal(snapshot.lineId, "PKG-02");
  assert.equal(snapshot.maintenanceWindowId, scenario.maintenance.maintenanceWindowId);
  assert.equal(snapshot.requiredIncrementalUnits, 100_000);
  assert.equal(snapshot.headroomWithMaintenanceUnits, 42_080);
  assert.equal(snapshot.shortfallUnits, 57_920);
  assert.equal(snapshot.recommendedOption.optionId, "OPT-4");
  assert.equal(snapshot.deferralDays, 28);
  assert.equal(snapshot.projectedStressPctOfThreshold, 111.26);
  assert.equal(snapshot.stressCeilingPct, 115);
});

test("rejects an Operations Agent action without the named approver", () => {
  assert.throws(
    () => requireApproval("production-plan-change", undefined),
    /ROLE-OPERATIONS-APPROVER/,
  );
  assert.throws(
    () =>
      requireApproval("maintenance-deferral", {
        role: "ROLE-OPERATIONS-APPROVER",
        approvedAt: "2027-06-14T09:05:00Z",
      }),
    /ROLE-MAINTENANCE-APPROVER/,
  );
});

test("accepts only the role assigned to each consequential action", () => {
  assert.equal(
    requireApproval("production-plan-change", {
      role: "ROLE-OPERATIONS-APPROVER",
      approvedAt: "2027-06-14T09:05:00Z",
    }).role,
    "ROLE-OPERATIONS-APPROVER",
  );
  assert.equal(
    requireApproval("maintenance-deferral", {
      role: "ROLE-MAINTENANCE-APPROVER",
      approvedAt: "2027-06-14T09:12:00Z",
    }).role,
    "ROLE-MAINTENANCE-APPROVER",
  );
});