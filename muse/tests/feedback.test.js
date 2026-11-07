import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { FileMuseStore, recordFeedback } from "../feedback/store.js";
import { recommend } from "../pipeline.js";
import { piece, request } from "./helpers.js";

describe("feedback store", () => {
  it("reloads a recommendation and its feedback from disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-"));
    const store = new FileMuseStore(dir);
    const result = recommend(request([piece("top", "top"), piece("bottom", "bottom"), piece("shoes", "shoes")]), {
      store,
    });
    const saved = recordFeedback(
      {
        recommendation_id: result.body.recommendation_id,
        outfit_id: result.body.recommendations[0].outfit_id,
        action: "worn",
      },
      { store, now: () => "2026-04-01T00:00:00.000Z" },
    );
    assert.equal(saved.statusCode, 200);
    const reloaded = new FileMuseStore(dir);
    const again = reloaded.getRecommendation(result.body.recommendation_id);
    assert.equal(again.shown[0].garment_ids.join(","), "top,bottom,shoes");
    assert.equal(reloaded.eventsForUser("user-1")[0].action, "worn");
    assert.equal(reloaded.eventsForUser("user-1")[0].recommendation_id, result.body.recommendation_id);
    const mismatch = recordFeedback(
      {
        recommendation_id: result.body.recommendation_id,
        outfit_id: "outfit-other",
        action: "like",
      },
      { store: reloaded },
    );
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.body.error, "feedback_mismatch");
  });
});
