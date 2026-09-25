import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(
  new URL("../../data/fabric-sql/008_governed_action_runtime.sql", import.meta.url),
  "utf8",
);

test("runtime SQL generates receipts and journals observed execution separately from fixtures", () => {
  assert.match(sql, /CREATE TABLE dbo\.runtime_action_executions/);
  assert.match(sql, /CONCAT\('RCPT-', CONVERT\(varchar\(36\), NEWID\(\)\)\)/);
  assert.doesNotMatch(sql, /FROM dbo\.governed_actions WITH/);
  assert.doesNotMatch(sql, /INNER JOIN dbo\.action_receipts/);
});

test("runtime SQL enforces identity, fresh approval, policy, and idempotency in one transaction", () => {
  assert.match(sql, /BEGIN TRANSACTION/);
  assert.match(sql, /UPDLOCK, HOLDLOCK/);
  assert.match(sql, /@existingInvocation <> @invocationId OR @existingType <> @actionType/);
  assert.match(sql, /@actorObjectId/);
  assert.match(sql, /outside the permitted server window/);
  assert.match(sql, /requiredApproverRole = @actorRole/);
  assert.match(sql, /secondaryApproverRole = @actorRole/);
  assert.match(sql, /status = 'approved'/);
  assert.match(sql, /UNIQUE \(correlationId\)/);
  assert.match(sql, /PRIMARY KEY \(invocationId\)/);
});

test("runtime SQL mutates production and maintenance state through the procedure only", () => {
  assert.match(sql, /CREATE TABLE dbo\.runtime_production_plan_state/);
  assert.match(sql, /CREATE TABLE dbo\.runtime_maintenance_state/);
  assert.match(sql, /MERGE dbo\.runtime_production_plan_state/);
  assert.match(sql, /MERGE dbo\.runtime_maintenance_state/);
  assert.match(sql, /DENY INSERT, UPDATE, DELETE ON dbo\.runtime_production_plan_state/);
  assert.match(sql, /DENY INSERT, UPDATE, DELETE ON dbo\.runtime_maintenance_state/);
});

test("least-privilege role can call the procedure but cannot write authority tables", () => {
  assert.match(sql, /GRANT EXECUTE ON dbo\.execute_governed_action TO caldova_action_executor/);
  assert.match(sql, /DENY INSERT, UPDATE, DELETE ON dbo\.governed_actions/);
  assert.match(sql, /DENY INSERT, UPDATE, DELETE ON dbo\.action_receipts/);
  assert.match(sql, /DENY INSERT, UPDATE, DELETE ON dbo\.runtime_action_executions/);
});