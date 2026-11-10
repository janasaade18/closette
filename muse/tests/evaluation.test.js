import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scenarios } from "../evaluation/scenarios.js";
import { runScenario } from "../evaluation/checks.js";

describe("manual evaluation scenarios", () => {
  for (const scenario of scenarios) {
    it(scenario.title, () => {
      const result = runScenario(scenario);
      assert.deepEqual(result.problems, []);
    });
  }
});
