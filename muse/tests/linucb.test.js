import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SharedLinUCB, invertMatrix } from "../personalization/linucb.js";

describe("shared LinUCB", () => {
  it("inverts a small matrix", () => {
    const inverse = invertMatrix([
      [4, 7],
      [2, 6],
    ]);
    assert.ok(Math.abs(inverse[0][0] - 0.6) < 1e-9);
    assert.ok(Math.abs(inverse[0][1] - -0.7) < 1e-9);
    assert.ok(Math.abs(inverse[1][0] - -0.2) < 1e-9);
    assert.ok(Math.abs(inverse[1][1] - 0.4) < 1e-9);
  });

  it("starts uncertain and moves toward rewarded features", () => {
    const model = new SharedLinUCB({ dim: 2, alpha: 1 });
    const good = [1, 0];
    const other = [0, 1];
    const initial = model.score(good);
    assert.equal(initial.mean, 0);
    assert.ok(initial.bonus > 0);
    for (let step = 0; step < 8; step += 1) {
      model.update(good, 1);
      model.update(other, 0);
    }
    assert.ok(model.score(good).mean > model.score(other).mean);
  });
});
