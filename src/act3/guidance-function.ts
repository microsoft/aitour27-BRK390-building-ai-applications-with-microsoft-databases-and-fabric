import type { HttpRequest, HttpResponseInit } from "@azure/functions";

import type { AccessTokenVerifier } from "./auth.ts";
import { GuidanceInputError, retrieveGuidance, type GuidanceStore, type TextEmbedder } from "./guidance.ts";

export function createGuidanceHandler(dependencies: {
  tokenVerifier: AccessTokenVerifier;
  resources: () => Promise<{ store: GuidanceStore; embedder: TextEmbedder }>;
}) {
  return async (request: HttpRequest): Promise<HttpResponseInit> => {
    const reply = (status: number, jsonBody: unknown): HttpResponseInit => ({
      status, jsonBody, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
    let identity;
    try {
      identity = await dependencies.tokenVerifier.verify(request.headers.get("authorization") ?? undefined);
    } catch {
      return reply(401, { error: "valid_access_token_required" });
    }
    if (!identity.roles.includes("ROLE-ACT3-READER")) {
      return reply(403, { error: "reader_role_required" });
    }
    if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return reply(415, { error: "json_required" });
    }
    let input;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > 8192) return reply(413, { error: "request_too_large" });
      input = JSON.parse(text);
    } catch {
      return reply(400, { error: "invalid_json" });
    }
    try {
      const { store, embedder } = await dependencies.resources();
      return reply(200, await retrieveGuidance(input, store, embedder));
    } catch (error) {
      if (error instanceof GuidanceInputError) return reply(400, { error: error.message });
      return reply(503, { error: "guidance_unavailable" });
    }
  };
}