import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer } from "../api/server.js";
import { MemoryMuseStore } from "../feedback/store.js";
import { MemoryCatalog, recommend } from "../pipeline.js";
import { piece } from "./helpers.js";

const demo = [
  piece("top", "item-001", { style_tags: ["minimal"], temperature_range_c: { min_c: 16, max_c: 32 }, availability: "clean" }),
  piece("bottom", "item-002", { temperature_range_c: { min_c: 10, max_c: 28 }, availability: "available" }),
  piece("shoes", "item-003", { temperature_range_c: { min_c: 10, max_c: 32 } }),
  piece("jacket", "item-004", { temperature_range_c: { min_c: 8, max_c: 18 }, colors: { primary: "beige" } }),
];

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

describe("HTTP API", () => {
  it("validates missing and malformed fields", () => {
    assert.equal(recommend({}).statusCode, 400);
    assert.equal(recommend({ user_id: "user-1", wardrobe: demo, limit: 0 }).body.error, "invalid_request");
    assert.equal(
      recommend({ user_id: "user-1", wardrobe: demo, weather: { temperature_c: "warm" } }).statusCode,
      400,
    );
    assert.equal(
      recommend({
        user_id: "user-1",
        wardrobe: [{ id: "a", category: "tops" }, { id: "a", category: "tops" }],
      }).body.fields.wardrobe.includes("duplicate"),
      true,
    );
    const missing = recommend({ user_id: "user-1", wardrobe_item_ids: ["item-001"] });
    assert.equal(missing.statusCode, 422);
    assert.equal(missing.body.error, "wardrobe_unavailable");
    assert.equal(recommend({ user_id: "user-1", personalization: "linucb", wardrobe: demo }).body.error, "personalization_not_available");
  });

  it("resolves wardrobe ids from a catalog", () => {
    const result = recommend(
      {
        user_id: "user-123",
        occasion: "casual",
        weather: { temperature_c: 22 },
        wardrobe_item_ids: ["item-001", "item-002", "item-003", "item-004", "missing"],
        limit: 3,
      },
      { catalog: new MemoryCatalog({ "user-123": demo }) },
    );
    assert.equal(result.body.status, "ok");
    assert.deepEqual(result.body.recommendations[0].items, ["item-001", "item-002", "item-003"]);
    assert.equal(result.body.recommendations[0].items.includes("item-004"), false);
    assert.ok(result.body.warnings.some((warning) => warning.code === "unknown_wardrobe_items"));
    assert.equal(result.body.model_version, "muse-ranker-v1");
    assert.equal(result.body.score_semantics, "mlp_preference_score_in_0_1");
  });

  it("serves recommend and feedback over HTTP", async () => {
    const store = new MemoryMuseStore();
    const server = createServer({
      store,
      catalog: new MemoryCatalog({ "user-123": demo }),
      now: () => "2026-06-01T12:00:00.000Z",
    });
    const port = await listen(server);
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal((await health.json()).ok, true);
      const response = await fetch(`http://127.0.0.1:${port}/v1/outfits/recommend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: "user-123",
          occasion: "casual",
          weather: { temperature_c: 22 },
          wardrobe_item_ids: ["item-001", "item-002", "item-003", "item-004"],
          limit: 3,
        }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.recommendations.length, 1);
      const badMethod = await fetch(`http://127.0.0.1:${port}/v1/outfits/recommend`);
      assert.equal(badMethod.status, 405);
      const feedback = await fetch(`http://127.0.0.1:${port}/v1/outfits/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recommendation_id: body.recommendation_id,
          outfit_id: body.recommendations[0].outfit_id,
          action: "dislike",
          reason: { code: "color", note: "too much navy" },
        }),
      });
      assert.equal(feedback.status, 200);
      const stored = await feedback.json();
      assert.deepEqual(stored.feedback.garment_ids, body.recommendations[0].items);
      assert.equal(stored.feedback.reason.code, "color");
      assert.equal(stored.feedback.timestamp, "2026-06-01T12:00:00.000Z");
      const unknown = await fetch(`http://127.0.0.1:${port}/v1/outfits/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recommendation_id: "rec-missing", outfit_id: "outfit-x", action: "like" }),
      });
      assert.equal(unknown.status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
