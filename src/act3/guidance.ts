export type MaintenancePolicy = {
  policyId: string;
  policyVersion: string;
  status: string;
  effectiveFrom: string;
  ruleJson: string;
};

export type GuidanceMatch = {
  guidanceId: string;
  title: string;
  excerpt: string;
  sourceCaseId: string;
  sourceVersion: string;
  sourceHash: string;
  policyId: string;
  policyVersion: string;
  distance: number;
};

export type GuidanceContext = {
  caseId: string;
  lineId: string;
};

export type GuidanceStore = {
  getContext(caseId: string): Promise<GuidanceContext | undefined>;
  search(context: GuidanceContext, vector: number[], embeddingProfile: string): Promise<GuidanceMatch[]>;
};

export type TextEmbedder = {
  profile: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
};

export class GuidanceInputError extends Error {}

export function validateEmbedding(vector: unknown, dimensions: number): asserts vector is number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions
    || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))
    || vector.every((value) => value === 0)) {
    throw new Error("The embedding provider returned an invalid vector.");
  }
}

export async function retrieveGuidance(
  input: unknown,
  store: GuidanceStore,
  embedder: TextEmbedder,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GuidanceInputError("A case and question are required.");
  }
  const { caseId, question } = input as Record<string, unknown>;
  if (typeof caseId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(caseId)
    || typeof question !== "string" || question.trim().length < 3 || question.length > 2000) {
    throw new GuidanceInputError("Provide a valid case identifier and a question of 3 to 2000 characters.");
  }
  const context = await store.getContext(caseId);
  if (!context) throw new GuidanceInputError("The case is unavailable.");
  const vector = await embedder.embed(question.trim());
  validateEmbedding(vector, embedder.dimensions);
  const matches = await store.search(context, vector, embedder.profile);
  return {
    caseId: context.caseId,
    matches,
    result: matches.length ? "matches" : "no_approved_guidance",
    retrieval: { method: "exact_cosine_distance", embeddingProfile: embedder.profile },
  };
}

export function evaluateMaintenanceDeferral(
  policy: MaintenancePolicy,
  proposal: { sustainedRateFactor: number; deferralDays: number; projectedStressPct: number },
  now: Date,
) {
  const blocked = (reason: string) => ({
    permitted: false as const, reason, policyId: policy.policyId, policyVersion: policy.policyVersion,
  });
  const effectiveFrom = Date.parse(policy.effectiveFrom);
  if (policy.status !== "approved" || !Number.isFinite(effectiveFrom)
    || !Number.isFinite(now.getTime()) || effectiveFrom > now.getTime()) {
    return blocked("The policy is not currently approved and effective.");
  }
  if (!Number.isFinite(proposal.sustainedRateFactor) || proposal.sustainedRateFactor <= 0
    || !Number.isInteger(proposal.deferralDays) || proposal.deferralDays < 0
    || !Number.isFinite(proposal.projectedStressPct) || proposal.projectedStressPct < 0) {
    return blocked("The proposed operating values are invalid.");
  }
  let rule;
  try {
    rule = JSON.parse(policy.ruleJson);
  } catch {
    return blocked("The policy rule is invalid.");
  }
  if (!rule || rule.effect !== "conditional_permit"
    || typeof rule.requiredApproverRole !== "string" || !rule.requiredApproverRole.trim()
    || typeof rule.stressCeilingPct !== "number" || !Number.isFinite(rule.stressCeilingPct)
    || rule.stressCeilingPct <= 0
    || !Array.isArray(rule.deferralTable) || !rule.deferralTable.length) {
    return blocked("The policy rule is incomplete or unsupported.");
  }
  let previousRate = 0;
  let previousDays = Number.POSITIVE_INFINITY;
  for (const band of rule.deferralTable) {
    if (!band || typeof band.maxSustainedRateFactor !== "number"
      || !Number.isFinite(band.maxSustainedRateFactor)
      || band.maxSustainedRateFactor <= previousRate || band.maxSustainedRateFactor > 1
      || !Number.isInteger(band.maxDeferralDays) || band.maxDeferralDays < 0
      || band.maxDeferralDays > previousDays) {
      return blocked("The policy rate table is invalid.");
    }
    previousRate = band.maxSustainedRateFactor;
    previousDays = band.maxDeferralDays;
  }
  const band = rule.deferralTable.find(
    (entry: { maxSustainedRateFactor: number }) => proposal.sustainedRateFactor <= entry.maxSustainedRateFactor,
  );
  if (!band || proposal.deferralDays > band.maxDeferralDays) {
    return blocked("The requested deferral exceeds the limit at this operating rate.");
  }
  if (proposal.projectedStressPct > rule.stressCeilingPct) {
    return blocked("Projected stress exceeds the policy ceiling.");
  }
  return {
    permitted: true as const,
    reason: "Within maintenance limits; named approval and execution-time revalidation are required.",
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    maximumDeferralDays: band.maxDeferralDays,
    requiredApproverRole: rule.requiredApproverRole as string,
  };
}