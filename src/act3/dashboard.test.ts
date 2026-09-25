import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";

import { dashboardHtml } from "./dashboard.ts";

test("the emitted dashboard JavaScript parses in the browser", () => {
  const scripts = [...dashboardHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Script(script[1]));
  }
});