import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";

import { createGuidanceHandler } from "./guidance-function.ts";

const request = (body = JSON.stringify({ caseId: "CASE-1", question: "maintenance guidance" })) => new HttpRequest({
  method: "POST", url: "https://localhost/api/act3/guidance",
  headers: { "content-type": "application/json", authorization: "Bearer test-only" },
  body: { string: body },
});

test("unauthenticated and non-reader callers cannot open SQL or invoke models", async () => {
  for (const roles of [undefined, [], ["ROLE-OPERATIONS-APPROVER"]]) {
    const handler = createGuidanceHandler({
      tokenVerifier: { async verify() { if (!roles) throw new Error("invalid"); return { objectId: "test-reader", roles }; } },
      async resources() { assert.fail("unauthorized resources access"); },
    });
    assert.equal((await handler(request())).status, roles ? 403 : 401);
  }
});

test("the Function returns real retrieval service output and disables caching", async () => {
  const handler = createGuidanceHandler({
    tokenVerifier: { async verify() { return { objectId: "test-reader", roles: ["ROLE-ACT3-READER"] }; } },
    async resources() {
      return {
        store: { async getContext(caseId) { return { caseId, lineId: "PKG-02" }; }, async search() { return []; } },
        embedder: { profile: "test-only", dimensions: 3, async embed() { return [1, 0, 0]; } },
      };
    },
  });
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.equal(new Headers(result.headers as HeadersInit).get("cache-control"), "no-store");
  assert.equal((result.jsonBody as { result: string }).result, "no_approved_guidance");
});

test("malformed and oversized bodies fail before dependencies are opened", async () => {
  const handler = createGuidanceHandler({
    tokenVerifier: { async verify() { return { objectId: "test-reader", roles: ["ROLE-ACT3-READER"] }; } },
    async resources() { assert.fail("must not open resources"); },
  });
  assert.equal((await handler(request("{"))).status, 400);
  assert.equal((await handler(request("x".repeat(8193)))).status, 413);
});

test("dependency failures do not expose private infrastructure diagnostics", async () => {
  const handler = createGuidanceHandler({
    tokenVerifier: { async verify() { return { objectId: "test-reader", roles: ["ROLE-ACT3-READER"] }; } },
    async resources() { throw new Error("private SQL connection and provider details"); },
  });
  const result = await handler(request());
  assert.equal(result.status, 503);
  assert.deepEqual(result.jsonBody, { error: "guidance_unavailable" });
});