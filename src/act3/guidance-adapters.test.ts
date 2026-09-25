import assert from "node:assert/strict";
import test from "node:test";

import { AzureOpenAIEmbedder, GUIDANCE_DIMENSIONS, GUIDANCE_SEARCH_SQL, SqlGuidanceStore } from "./guidance-adapters.ts";
import type sql from "mssql";

const config = { endpoint: "https://test-only.openai.azure.com", deployment: "embedding-test", profile: "test-only-profile" };
const credential = { async getToken(scope: string) { assert.equal(scope, "https://cognitiveservices.azure.com/.default"); return { token: "test-token" }; } };
const vector = Array.from({ length: GUIDANCE_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0);

test("embedding adapter uses Entra authentication, blocks redirects and validates model dimensions", async () => {
  const embedder = new AzureOpenAIEmbedder(config, credential, async (url, init) => {
    assert.equal(String(url), "https://test-only.openai.azure.com/openai/deployments/embedding-test/embeddings?api-version=2024-02-01");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
    assert.deepEqual(JSON.parse(String(init?.body)), { input: "maintenance" });
    return Response.json({ data: [{ index: 0, embedding: vector }] });
  });
  assert.deepEqual(await embedder.embed("maintenance"), vector);
  assert.equal(embedder.profile, config.profile);
});

test("invalid embedding endpoints and provider failures fail closed without leaking the response", async () => {
  for (const endpoint of ["http://test-only.openai.azure.com", "https://example.com", "https://test-only.openai.azure.com.evil.test", "https://user:secret@test-only.openai.azure.com", "https://test-only.openai.azure.com/path"]) {
    assert.throws(() => new AzureOpenAIEmbedder({ ...config, endpoint }, credential));
  }
  const badResponse = new AzureOpenAIEmbedder(config, credential, async () => new Response("private provider diagnostic", { status: 500 }));
  await assert.rejects(badResponse.embed("maintenance"), { message: "The embedding service is unavailable." });
  const wrongDimensions = new AzureOpenAIEmbedder(config, credential, async () => Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] }));
  await assert.rejects(wrongDimensions.embed("maintenance"), /invalid vector/);
});

test("SQL retrieval binds all values and includes current-policy and publication filters", async () => {
  const bound = new Map();
  const request = {
    input(name: string, _type: unknown, value: unknown) { bound.set(name, value); return request; },
    async query(query: string) { assert.equal(query, GUIDANCE_SEARCH_SQL); return { recordset: [] }; },
  };
  const pool = { request: () => request } as unknown as sql.ConnectionPool;
  const store = new SqlGuidanceStore(pool, 0.4);
  const lineId = "line'; DROP TABLE ignored;--";
  assert.deepEqual(await store.search({ caseId: "CASE-1", lineId }, vector, "test-profile"), []);
  assert.equal(bound.get("lineId"), lineId);
  assert.equal(bound.get("embeddingProfile"), "test-profile");
  assert.deepEqual(JSON.parse(bound.get("embedding")), vector);
  assert.ok(!GUIDANCE_SEARCH_SQL.includes(lineId));
  for (const fragment of ["VECTOR_DISTANCE('cosine'", "policy.policyVersion = guidance.policyVersion", "guidance.status = 'approved'", "guidance.validUntil > SYSUTCDATETIME()", "guidance.embeddingProfile = @embeddingProfile", "ORDER BY distance, guidance.guidanceId"]) {
    assert.ok(GUIDANCE_SEARCH_SQL.includes(fragment), fragment);
  }
  for (const limit of [NaN, Infinity, 0, -1, 2.01]) assert.throws(() => new SqlGuidanceStore(pool, limit));
});