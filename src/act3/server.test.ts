import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GovernedActionService, InMemoryReceiptStore } from "./action-service.ts";
import type { AccessTokenVerifier } from "./auth.ts";
import { buildAct3Snapshot } from "./domain.ts";
import type { Act3Runtime } from "./runtime.ts";
import { createAct3Server } from "./server.ts";

const scenario = JSON.parse(
  await readFile(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const productionAction = scenario.actions.find((action: {actionId: string}) => action.actionId === "ACT-PROD-002");
const actionService = new GovernedActionService(scenario, new InMemoryReceiptStore());
const runtime: Act3Runtime = {
  authority: "fixture",
  async getSnapshot() { return buildAct3Snapshot(scenario); },
  async applyProductionPlan(command) { return actionService.applyProductionPlan(command); },
  async deferMaintenance(command) { return actionService.deferMaintenance(command); },
};

async function withServer(
  tokenVerifier: AccessTokenVerifier,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createAct3Server({
    runtime,
    tokenVerifier,
    browserAuth: {
      tenantId: "00000000-0000-0000-0000-000000000001",
      clientId: "00000000-0000-0000-0000-000000000002",
      apiScope: "api://00000000-0000-0000-0000-000000000002/Act3.Approve",
    },
    now: () => new Date(productionAction.approvedAt),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

const rejectTokens: AccessTokenVerifier = {
  async verify() { throw new Error("invalid token"); },
};

function acceptToken(...roles: string[]): AccessTokenVerifier {
  return {
    async verify() {
      return { objectId: "00000000-0000-0000-0000-000000000123", roles };
    },
  };
}

test("serves the scenario-derived Operations Agent snapshot", async () => {
  await withServer(acceptToken("ROLE-ACT3-READER"), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/act3/snapshot`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.recommendedOption.optionId, "OPT-4");
    assert.equal(body.shortfallUnits, 57_920);
  });
});

test("snapshots require a verified reader and errors do not reveal data", async () => {
  for (const [verifier, expected] of [[rejectTokens, 401], [acceptToken("ROLE-OPERATIONS-APPROVER"), 403]] as const) {
    await withServer(verifier, async baseUrl => {
      const response = await fetch(`${baseUrl}/v1/act3/snapshot`);
      assert.equal(response.status, expected);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.doesNotMatch(await response.text(), /shortfallUnits|options|actorObjectId/);
    });
  }
});

test("dependency errors never expose exception details", async () => {
  const original = runtime.getSnapshot;
  runtime.getSnapshot = async () => { throw new Error("private connection details"); };
  try {
    await withServer(acceptToken("ROLE-ACT3-READER"), async baseUrl => {
      const response = await fetch(`${baseUrl}/v1/act3/snapshot`);
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /private connection/);
    });
  } finally { runtime.getSnapshot = original; }
});

test("serves an inspectable operations console at the shared root URL", async () => {
  await withServer(rejectTokens, async (baseUrl) => {
    const response = await fetch(baseUrl);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(body, /Caldova operations/);
    assert.match(body, /Campaign capacity conflict/);
    assert.match(body, /\/v1\/act3\/snapshot/);
  });
});

test("serves the public browser authentication configuration", async () => {
  await withServer(rejectTokens, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/config`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.clientId, "00000000-0000-0000-0000-000000000002");
    assert.equal(body.apiScope, "api://00000000-0000-0000-0000-000000000002/Act3.Approve");
  });
});

test("fails closed when the bearer token cannot be verified", async () => {
  await withServer(rejectTokens, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/actions/production-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: "ACT-PROD-002",
        correlationId: `${scenario.decisionCase.caseId}/OPT-4`,
      }),
    });
    assert.equal(response.status, 401);
  });
});

test("executes an approved action using verified claims rather than request-authored roles", async () => {
  await withServer(acceptToken("ROLE-OPERATIONS-APPROVER"), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/actions/production-plan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer verified-by-test-double",
      },
      body: JSON.stringify({
        actionId: "ACT-PROD-002",
        correlationId: `${scenario.decisionCase.caseId}/OPT-4`,
        role: "ROLE-MAINTENANCE-APPROVER",
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.receiptId, productionAction.receiptId);
    assert.equal(body.approverRole, "ROLE-OPERATIONS-APPROVER");
  });
});

test("keeps production and maintenance approval roles separate", async () => {
  await withServer(acceptToken("ROLE-OPERATIONS-APPROVER"), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/actions/maintenance-deferral`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer verified-by-test-double",
      },
      body: JSON.stringify({
        actionId: "ACT-MNT-002",
        correlationId: `${scenario.decisionCase.caseId}/OPT-4/maintenance`,
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.requiredRole, "ROLE-MAINTENANCE-APPROVER");
  });
});