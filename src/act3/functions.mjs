import { app } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import sql from "mssql";
import { readFile } from "node:fs/promises";

import { EntraAccessTokenVerifier, loadEntraVerifierConfig } from "./auth.ts";
import { AzureOpenAIEmbedder, SqlGuidanceStore } from "./guidance-adapters.ts";
import { createGuidanceHandler } from "./guidance-function.ts";
import { createReviewHandler } from "./review-api.ts";
import { createSqlResources, SQL_TIMEOUTS } from "./sql-resources.mjs";
import { createStaffingHandler } from "./staffing-api.ts";
import { createCosmosMemoryReader } from "./staffing-memory.ts";
import { createStaffingReadiness } from "./staffing-readiness.mjs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
let verifier;
const resources = createSqlResources({
  log: (event, details) => console.info(event, details),
  createPool: () => {
    const server = required("ACT3_SQL_SERVER");
    if (!/^[a-z0-9-]+\.database\.windows\.net$/i.test(server)) {
      throw new Error("ACT3_SQL_SERVER must name the approved standalone Azure SQL server.");
    }
    return new sql.ConnectionPool({
      server,
      database: required("ACT3_SQL_DATABASE"),
      authentication: { type: "azure-active-directory-default", options: {} },
      options: { encrypt: true, trustServerCertificate: false },
      pool: { max: 5, min: 0, idleTimeoutMillis: 30_000,
        acquireTimeoutMillis: SQL_TIMEOUTS.request, createTimeoutMillis: SQL_TIMEOUTS.connect },
      connectionTimeout: SQL_TIMEOUTS.connect,
      requestTimeout: SQL_TIMEOUTS.request,
    });
  },
  createResources: pool => {
    const maxDistance = Number(required("ACT3_GUIDANCE_MAX_DISTANCE"));
    if (!Number.isFinite(maxDistance) || maxDistance <= 0 || maxDistance > 2) {
      throw new Error("Calibrate ACT3_GUIDANCE_MAX_DISTANCE before enabling retrieval.");
    }
    const embedder = new AzureOpenAIEmbedder({
      endpoint: required("ACT3_EMBEDDING_ENDPOINT"),
      deployment: required("ACT3_EMBEDDING_DEPLOYMENT"),
      profile: required("ACT3_EMBEDDING_PROFILE"),
    }, new DefaultAzureCredential());
    const budgetedEmbedder = {
        profile: embedder.profile, dimensions: embedder.dimensions,
        async embed(text) {
          await pool.request().execute("act3.consume_embedding_budget");
          return embedder.embed(text);
        },
    };
    return { pool, store: new SqlGuidanceStore(pool, maxDistance), embedder: budgetedEmbedder };
  },
});

app.http("act3Guidance", {
  route: "act3/guidance",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: createGuidanceHandler({
    tokenVerifier: {
      async verify(authorization) {
        verifier ??= new EntraAccessTokenVerifier(loadEntraVerifierConfig(process.env));
        return verifier.verify(authorization);
      },
    },
    resources,
  }),
});

const tokenVerifier = {
  async verify(authorization) {
    verifier ??= new EntraAccessTokenVerifier(loadEntraVerifierConfig(process.env));
    return verifier.verify(authorization);
  },
};
app.http("act3Review", { route: "review/{action}", methods: ["GET", "POST"], authLevel: "anonymous",
  handler: createReviewHandler({ tokenVerifier, resources }),
});
let cosmosMemoryReader;
const readStaffingMemory = async (id, partition) => {
  cosmosMemoryReader ??= createCosmosMemoryReader({endpoint: required("ACT3_COSMOS_ENDPOINT"),
    database: required("ACT3_COSMOS_DATABASE"), container: required("ACT3_COSMOS_CONTAINER")});
  return cosmosMemoryReader(id, partition);
};
app.http("act3StaffingReadiness", { route: "staffing-readiness", methods: ["GET"], authLevel: "function",
  handler: createStaffingReadiness({ resources, caseId: process.env.ACT3_STAFFING_CASE_ID || "",
    readMemory: readStaffingMemory, log: (event, details) => console.error(event, details) }),
});
app.http("act3Staffing", { route: "staffing/{action}", methods: ["GET", "POST"], authLevel: "anonymous",
  handler: createStaffingHandler({ tokenVerifier, resources,
    caseId: process.env.ACT3_STAFFING_CASE_ID || "",
    readMemory: readStaffingMemory,
  }),
});
app.http("act3StaffingApp", { route: "staffing-app", methods: ["GET"], authLevel: "anonymous", handler: async () => ({
  body: await readFile(new URL("./web/staffing.html", import.meta.url), "utf8"),
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://login.microsoftonline.com; frame-src 'self' https://login.microsoftonline.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" },
}) });
app.http("act3Config", { route: "config", methods: ["GET"], authLevel: "anonymous", handler: async () => ({
  jsonBody: { tenantId: required("ENTRA_TENANT_ID"), clientId: required("ENTRA_CLIENT_ID"), apiScope: required("ENTRA_API_SCOPE"),
    redirectUri: required("ACT3_REDIRECT_URI"),
    silentRedirectUri: new URL('/api/auth-redirect', required("ACT3_REDIRECT_URI")).href },
  headers: { "cache-control": "no-store" },
}) });
app.http("act3App", { route: "app", methods: ["GET"], authLevel: "anonymous", handler: async () => ({
  body: await readFile(new URL("./web/index.html", import.meta.url), "utf8"),
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://login.microsoftonline.com; frame-src 'self' https://login.microsoftonline.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" },
}) });
app.http("act3AuthRedirect", { route: "auth-redirect", methods: ["GET"], authLevel: "anonymous", handler: async () => ({
  body: await readFile(new URL("./web/auth-redirect.html", import.meta.url), "utf8"),
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" },
}) });
const assets = {
  "auth-redirect.js": ["./web/auth-redirect.js", "text/javascript"],
  "msal-redirect-bridge.js": ["../../node_modules/@azure/msal-browser/lib/redirect-bridge/msal-redirect-bridge.min.js", "text/javascript"],
  "app.js": ["./web/app.js", "text/javascript"], "app.css": ["./web/app.css", "text/css"],
  "staffing.js": ["./web/staffing.js", "text/javascript"], "staffing.css": ["./web/staffing.css", "text/css"],
  "sql.png": ["./web/sql.png", "image/png"],
  "msal.js": ["../../node_modules/@azure/msal-browser/lib/msal-browser.min.js", "text/javascript"],
  "lucide.js": ["../../node_modules/lucide/dist/umd/lucide.js", "text/javascript"],
};
app.http("act3Assets", { route: "assets/{name}", methods: ["GET"], authLevel: "anonymous", handler: async request => {
  if (!Object.hasOwn(assets, request.params.name)) return { status: 404 };
  const asset = assets[request.params.name];
  if (!asset) return { status: 404 };
  return { body: new Uint8Array(await readFile(new URL(asset[0], import.meta.url))),
    headers: { "content-type": asset[1], "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } };
} });