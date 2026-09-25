import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  EntraAccessTokenVerifier,
  loadBrowserAuthConfig,
  loadEntraVerifierConfig,
  type AccessTokenVerifier,
  type BrowserAuthConfig,
} from "./auth.ts";
import { dashboardHtml } from "./dashboard.ts";
import { createFabricRuntimeFromEnv } from "./fabric-runtime.ts";
import type { Act3Runtime } from "./runtime.ts";

type ServerOptions = {
  runtime: Act3Runtime;
  tokenVerifier: AccessTokenVerifier;
  browserAuth: BrowserAuthConfig;
  now?: () => Date;
};

const REQUIRED_ROLES = {
  "/v1/actions/production-plan": "ROLE-OPERATIONS-APPROVER",
  "/v1/actions/maintenance-deferral": "ROLE-MAINTENANCE-APPROVER",
} as const;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) {
      throw new Error("Request body exceeds 16 KiB.");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function createAct3Server(options: ServerOptions) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/") {
        sendHtml(response, dashboardHtml);
        return;
      }
      if (request.method === "GET" && url.pathname === "/assets/banner-ai-tour-27.png") {
        const banner = await readFile(new URL("../../img/banner-ai-tour-27.png", import.meta.url));
        response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
        response.end(banner);
        return;
      }
      if (request.method === "GET" && url.pathname === "/assets/msal-browser.min.js") {
        const script = await readFile(
          new URL("../../node_modules/@azure/msal-browser/lib/msal-browser.min.js", import.meta.url),
        );
        response.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "public, max-age=86400",
        });
        response.end(script);
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/config") {
        sendJson(response, 200, options.browserAuth);
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok", authority: options.runtime.authority });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/act3/snapshot") {
        let identity;
        try {
          identity = await options.tokenVerifier.verify(request.headers.authorization);
        } catch {
          sendJson(response, 401, { error: "valid_access_token_required" });
          return;
        }
        if (!identity.roles.includes("ROLE-ACT3-READER")) {
          sendJson(response, 403, { error: "reader_role_required" });
          return;
        }
        sendJson(response, 200, await options.runtime.getSnapshot());
        return;
      }
      if (request.method !== "POST" || !url.pathname.startsWith("/v1/actions/")) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      const requiredRole = REQUIRED_ROLES[url.pathname as keyof typeof REQUIRED_ROLES];
      if (!requiredRole) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }

      let identity;
      try {
        identity = await options.tokenVerifier.verify(request.headers.authorization);
      } catch {
        sendJson(response, 401, { error: "valid_access_token_required" });
        return;
      }
      if (!identity.roles.includes(requiredRole)) {
        sendJson(response, 403, { error: "approver_role_required", requiredRole });
        return;
      }

      const body = await readJson(request);
      const actionId = String(body.actionId ?? "");
      const correlationId = String(body.correlationId ?? "");
      const command = {
        actionId,
        correlationId,
        approval: { role: requiredRole, approvedAt: (options.now ?? (() => new Date()))().toISOString() },
      };
      const receipt = url.pathname === "/v1/actions/production-plan"
        ? await options.runtime.applyProductionPlan(command, identity.objectId)
        : url.pathname === "/v1/actions/maintenance-deferral"
          ? await options.runtime.deferMaintenance(command, identity.objectId)
          : undefined;
      if (!receipt) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      sendJson(response, 200, { ...receipt, actorObjectId: identity.objectId });
    } catch {
      sendJson(response, 503, { error: "operation_unavailable", writeOutcomeUnknown: request.method === "POST" });
    }
  });
}

if (import.meta.main) {
  const runtime = await createFabricRuntimeFromEnv(process.env);
  const tokenVerifier = new EntraAccessTokenVerifier(loadEntraVerifierConfig(process.env));
  const browserAuth = loadBrowserAuthConfig(process.env);
  const port = Number(process.env.PORT ?? 3903);
  const server = createAct3Server({ runtime, tokenVerifier, browserAuth });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Caldova Act 3 runtime listening on http://127.0.0.1:${port}`);
  });
}