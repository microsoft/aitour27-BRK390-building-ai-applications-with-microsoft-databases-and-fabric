import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMaintenanceDeferral, retrieveGuidance, validateEmbedding, type MaintenancePolicy } from "./guidance.ts";

const policy: MaintenancePolicy = {
  policyId: "POL-MAINT-002",
  policyVersion: "2.1",
  status: "approved",
  effectiveFrom: "2026-04-01T00:00:00Z",
  ruleJson: JSON.stringify({
    deferralTable: [
      { maxSustainedRateFactor: 0.85, maxDeferralDays: 42 },
      { maxSustainedRateFactor: 0.9, maxDeferralDays: 28 },
      { maxSustainedRateFactor: 0.95, maxDeferralDays: 14 },
      { maxSustainedRateFactor: 1, maxDeferralDays: 0 },
    ],
    stressCeilingPct: 115,
    requiredApproverRole: "ROLE-MAINTENANCE-APPROVER",
    effect: "conditional_permit",
  }),
};
const now = new Date("2026-08-03T08:12:00Z");
const proposal = { sustainedRateFactor: 0.9, deferralDays: 28, projectedStressPct: 110 };

test("full-rate deferral is blocked; reduced-rate deferral remains subject to human approval", () => {
  assert.equal(evaluateMaintenanceDeferral(policy, { ...proposal, sustainedRateFactor: 1 }, now).permitted, false);
  const result = evaluateMaintenanceDeferral(policy, proposal, now);
  assert.equal(result.permitted, true);
  if (result.permitted) {
    assert.equal(result.maximumDeferralDays, 28);
    assert.equal(result.requiredApproverRole, "ROLE-MAINTENANCE-APPROVER");
  }
});

test("rate-band boundaries and stress limits are enforced", () => {
  for (const [rate, days] of [[0.85, 42], [0.9, 28], [0.95, 14], [1, 0]]) {
    assert.equal(evaluateMaintenanceDeferral(policy, { ...proposal, sustainedRateFactor: rate, deferralDays: days }, now).permitted, true);
    assert.equal(evaluateMaintenanceDeferral(policy, { ...proposal, sustainedRateFactor: rate, deferralDays: days + 1 }, now).permitted, false);
  }
  assert.equal(evaluateMaintenanceDeferral(policy, { ...proposal, sustainedRateFactor: 0.90001 }, now).permitted, false);
  assert.equal(evaluateMaintenanceDeferral(policy, { ...proposal, projectedStressPct: 115 }, now).permitted, true);
  assert.equal(evaluateMaintenanceDeferral(policy, { ...proposal, projectedStressPct: 115.01 }, now).permitted, false);
});

test("invalid, withdrawn, future and malformed policy data fail closed", () => {
  for (const change of [
    { status: "withdrawn" }, { effectiveFrom: "2027-01-01" }, { effectiveFrom: "invalid" },
    { ruleJson: "{" }, { ruleJson: "null" }, { ruleJson: "{}" },
    { ruleJson: policy.ruleJson.replace('"conditional_permit"', '"deny"') },
    { ruleJson: policy.ruleJson.replace('"maxDeferralDays":28', '"maxDeferralDays":50') },
  ]) assert.equal(evaluateMaintenanceDeferral({ ...policy, ...change }, proposal, now).permitted, false);
  for (const change of [
    { sustainedRateFactor: NaN }, { sustainedRateFactor: 0 }, { sustainedRateFactor: 1.01 },
    { deferralDays: -1 }, { deferralDays: 1.5 }, { projectedStressPct: Infinity },
  ]) assert.equal(evaluateMaintenanceDeferral(policy, { ...proposal, ...change }, now).permitted, false);
});

test("retrieval derives scope from the case and preserves an honest empty result", async () => {
  const calls: unknown[] = [];
  const result = await retrieveGuidance({ caseId: "CASE-1", question: "  defer maintenance?  ", lineId: "FORGED" }, {
    async getContext(caseId) { return { caseId, lineId: "PKG-02" }; },
    async search(context, vector, profile) { calls.push({ context, vector, profile }); return []; },
  }, {
    profile: "test-only", dimensions: 3,
    async embed(question) { assert.equal(question, "defer maintenance?"); return [1, 0, 0]; },
  });
  assert.deepEqual(calls, [{ context: { caseId: "CASE-1", lineId: "PKG-02" }, vector: [1, 0, 0], profile: "test-only" }]);
  assert.equal(result.result, "no_approved_guidance");
  assert.deepEqual(result.matches, []);
});

test("invalid requests and unavailable cases never invoke the embedding model", async () => {
  const store = { async getContext() { return undefined; }, async search() { return []; } };
  const embedder = { profile: "test-only", dimensions: 3, async embed() { assert.fail("must not invoke"); } };
  for (const input of [null, [], {}, { caseId: "CASE-1", question: "x" }, { caseId: "CASE-1", question: "valid question" }]) {
    await assert.rejects(retrieveGuidance(input, store, embedder));
  }
});

test("malformed, zero, non-finite and wrong-dimensional embeddings are rejected", () => {
  for (const vector of [null, [], [0, 0, 0], [1, 2], [1, NaN, 3], [1, Infinity, 3], [1, "2", 3]]) {
    assert.throws(() => validateEmbedding(vector, 3));
  }
  assert.doesNotThrow(() => validateEmbedding([1, 0, 0], 3));
});