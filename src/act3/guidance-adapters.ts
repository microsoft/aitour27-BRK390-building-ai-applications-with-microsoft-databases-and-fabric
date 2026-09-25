import sql from "mssql";

import { validateEmbedding, type GuidanceContext, type GuidanceMatch, type GuidanceStore, type TextEmbedder } from "./guidance.ts";

export const GUIDANCE_DIMENSIONS = 1536;

export const GUIDANCE_SEARCH_SQL = `
DECLARE @queryVector VECTOR(1536) = CAST(@embedding AS VECTOR(1536));
SELECT TOP (5)
  guidance.guidanceId, guidance.title, guidance.excerpt,
  guidance.sourceCaseId, guidance.sourceVersion, guidance.sourceHash,
  guidance.policyId, guidance.policyVersion, guidance.sourceType,
  VECTOR_DISTANCE('cosine', guidance.embedding, @queryVector) AS distance
FROM act3.guidance AS guidance
INNER JOIN dbo.approved_policies AS policy
  ON policy.policyId = guidance.policyId AND policy.policyVersion = guidance.policyVersion
WHERE guidance.lineId = @lineId
  AND (guidance.status = 'source_approved' OR (guidance.status = 'approved' AND guidance.approvedAt <= SYSUTCDATETIME()))
  AND guidance.validFrom <= SYSUTCDATETIME()
  AND (guidance.validUntil IS NULL OR guidance.validUntil > SYSUTCDATETIME())
  AND policy.status = 'approved' AND policy.effectiveFrom <= SYSUTCDATETIME()
  AND guidance.embeddingProfile = @embeddingProfile
  AND VECTOR_DISTANCE('cosine', guidance.embedding, @queryVector) <= @maxDistance
ORDER BY distance, guidance.guidanceId;`;

export class SqlGuidanceStore implements GuidanceStore {
  readonly #pool: sql.ConnectionPool;
  readonly #maxDistance: number;

  constructor(pool: sql.ConnectionPool, maxDistance: number) {
    if (!Number.isFinite(maxDistance) || maxDistance <= 0 || maxDistance > 2) {
      throw new Error("A calibrated cosine distance limit between 0 and 2 is required.");
    }
    this.#pool = pool;
    this.#maxDistance = maxDistance;
  }

  async getContext(caseId: string): Promise<GuidanceContext | undefined> {
    const result = await this.#pool.request()
      .input("caseId", sql.NVarChar(100), caseId)
      .query<GuidanceContext>("SELECT caseId, lineId FROM dbo.decision_cases WHERE caseId = @caseId AND lineId IS NOT NULL;");
    return result.recordset[0];
  }

  async search(context: GuidanceContext, vector: number[], embeddingProfile: string): Promise<GuidanceMatch[]> {
    validateEmbedding(vector, GUIDANCE_DIMENSIONS);
    const result = await this.#pool.request()
      .input("embedding", sql.NVarChar(sql.MAX), JSON.stringify(vector))
      .input("lineId", sql.NVarChar(100), context.lineId)
      .input("embeddingProfile", sql.NVarChar(200), embeddingProfile)
      .input("maxDistance", sql.Float, this.#maxDistance)
      .query<GuidanceMatch>(GUIDANCE_SEARCH_SQL);
    return result.recordset;
  }
}

type TokenProvider = { getToken(scope: string): Promise<{ token: string } | null> };

export class AzureOpenAIEmbedder implements TextEmbedder {
  readonly dimensions = GUIDANCE_DIMENSIONS;
  readonly profile: string;
  readonly #url: URL;
  readonly #credential: TokenProvider;
  readonly #fetch: typeof fetch;

  constructor(config: { endpoint: string; deployment: string; profile: string }, credential: TokenProvider, fetcher: typeof fetch = fetch) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".openai.azure.com")
      || endpoint.username || endpoint.password || endpoint.port
      || endpoint.pathname !== "/" || endpoint.search || endpoint.hash
      || !/^[A-Za-z0-9_-]+$/.test(config.deployment)
      || !config.profile.trim() || config.profile.length > 200) {
      throw new Error("Configure an Azure OpenAI endpoint, deployment and pinned embedding profile.");
    }
    this.profile = config.profile;
    this.#url = new URL(`/openai/deployments/${encodeURIComponent(config.deployment)}/embeddings?api-version=2024-02-01`, endpoint);
    this.#credential = credential;
    this.#fetch = fetcher;
  }

  async embed(text: string): Promise<number[]> {
    const token = await this.#credential.getToken("https://cognitiveservices.azure.com/.default");
    if (!token) throw new Error("Embedding authentication is unavailable.");
    const response = await this.#fetch(this.#url, {
      method: "POST",
      headers: { authorization: `Bearer ${token.token}`, "content-type": "application/json" },
      body: JSON.stringify({ input: text }),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("The embedding service is unavailable.");
    const body = await response.json() as { data?: { embedding?: unknown; index?: number }[] };
    if (!Array.isArray(body?.data) || body.data.length !== 1 || body.data[0]?.index !== 0) {
      throw new Error("The embedding service returned an unexpected result.");
    }
    const vector = body.data[0].embedding;
    validateEmbedding(vector, this.dimensions);
    return vector;
  }
}