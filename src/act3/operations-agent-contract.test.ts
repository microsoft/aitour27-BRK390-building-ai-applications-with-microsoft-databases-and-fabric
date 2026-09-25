import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contractText = await readFile(
  new URL("../fabric/CaldovaLaunch.OperationsAgent/Configurations.json", import.meta.url),
  "utf8",
);
const contract = JSON.parse(contractText);

test("Operations Agent monitors recommendations and has no execution authority", () => {
  assert.match(contract.configuration.instructions, /ProductionDecisionSignals/);
  assert.match(contract.configuration.instructions, /notify the configured Teams destination/);
  assert.match(contract.configuration.instructions, /do not calculate another option or invoke an action/);
  assert.deepEqual(contract.configuration.actions, {});
  assert.equal(contract.shouldRun, true);
  assert.deepEqual(contract.playbook, {});
});

test("contract reads event fields instead of duplicating scenario values", () => {
  for (const duplicatedValue of ["PKG-02", "OPT-4", "57920", "111.26", "115"] ) {
    assert.doesNotMatch(contractText, new RegExp(duplicatedValue.replace(".", "\\.")));
  }
  assert.match(contract.configuration.instructions, /recommendedOptionId/);
  assert.match(contract.configuration.instructions, /shortfallUnits/);
});

test("contract uses the current Operations Agent definition shape", () => {
  assert.deepEqual(Object.keys(contract).sort(), ["configuration", "playbook", "shouldRun"]);
  assert.ok(contract.configuration.dataSources.productionDecisionSignals.startsWith("$(/"));
});