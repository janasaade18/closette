import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../config.js";
import { MemoryMuseStore } from "../feedback/store.js";
import { recommend } from "../pipeline.js";
import { fitUserLinUCB } from "../personalization/fit.js";
import { rewardForFeedback } from "../personalization/rewards.js";
import { piece, request } from "./helpers.js";

function wardrobe() {
  return [
    piece("top", "top-a", { formality: "casual", colors: { primary: "white" }, style_tags: ["minimal"] }),
    piece("bottom", "bottom-a", { formality: "casual", colors: { primary: "blue" } }),
    piece("shoes", "shoes-a", { formality: "casual", colors: { primary: "white" } }),
    piece("top", "top-b", { formality: "smart-casual", colors: { primary: "navy" }, style_tags: ["classic"] }),
    piece("bottom", "bottom-b", { formality: "smart-casual", colors: { primary: "black" } }),
    piece("shoes", "shoes-b", { formality: "smart-casual", colors: { primary: "black" } }),
  ];
}

describe("phase 2 personalization", () => {
  it("maps purchase as a strong positive reward", () => {
    assert.equal(rewardForFeedback("purchase"), 1);
    assert.equal(rewardForFeedback("like"), 1);
    assert.equal(rewardForFeedback("dislike", { code: "color" }), 0);
    assert.equal(rewardForFeedback("dismiss"), 0.25);
  });

  it("does not personalize a cold user even when linucb is enabled", () => {
    const config = defaultConfig();
    config.personalization = "linucb";
    const result = recommend(request(wardrobe(), { limit: 2 }), { config, store: new MemoryMuseStore() });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.ranking.personalization, "linucb");
    assert.equal(result.body.ranking.personalization_applied, false);
    assert.equal(result.body.ranking.linucb_updates, 0);
  });

  it("fits LinUCB from logged feedback and reorders toward liked outfits", () => {
    const store = new MemoryMuseStore();
    const config = defaultConfig();
    config.personalization = "linucb";
    config.rankingPolicy = "learned";
    const body = request(wardrobe(), { limit: 2, weather: { temperature_c: 20 } });

    const first = recommend(body, { config, store });
    assert.equal(first.statusCode, 200);
    assert.ok(first.body.recommendations.length >= 1);

    const liked = first.body.recommendations[0];
    for (let index = 0; index < 4; index += 1) {
      store.addFeedback({
        recommendation_id: first.body.recommendation_id,
        outfit_id: liked.outfit_id,
        user_id: "user-1",
        garment_ids: [...liked.items],
        context: { occasion: "casual", season: null, weather: { temperature_c: 20 } },
        action: index === 3 ? "purchase" : "like",
        reason: null,
        source: index === 3 ? "marketplace" : "wardrobe",
        product_ids: index === 3 ? ["mkt-001"] : null,
        features: store.getRecommendation(first.body.recommendation_id).shown[0].features,
        timestamp: `2026-06-0${index + 1}T12:00:00.000Z`,
        model_version: first.body.model_version,
      });
    }

    const fitted = fitUserLinUCB(store.eventsForUser("user-1"), store, config);
    assert.equal(fitted.ready, true);
    assert.ok(fitted.updates >= 3);

    const second = recommend(body, { config, store });
    assert.equal(second.body.ranking.personalization_applied, true);
    assert.equal(second.body.ranking.method, "learned_mlp_plus_linucb");
    assert.ok(second.body.model_version.includes("linucb"));
    assert.deepEqual(second.body.recommendations[0].items, liked.items);
    assert.ok(second.body.recommendations[0].reason_codes.includes("linucb"));
  });

  it("accepts purchase feedback through the store contract", () => {
    const store = new MemoryMuseStore();
    const config = defaultConfig();
    config.personalization = "linucb";
    const first = recommend(request(wardrobe(), { limit: 1 }), { config, store });
    const outfit = first.body.recommendations[0];
    store.addFeedback({
      recommendation_id: first.body.recommendation_id,
      outfit_id: outfit.outfit_id,
      user_id: "user-1",
      garment_ids: [...outfit.items],
      context: first.body.recommendations ? { occasion: "casual" } : null,
      action: "purchase",
      reason: null,
      source: "marketplace",
      product_ids: ["sku-42"],
      features: store.getRecommendation(first.body.recommendation_id).shown[0].features,
      timestamp: "2026-07-01T00:00:00.000Z",
      model_version: first.body.model_version,
    });
    assert.equal(store.eventsForUser("user-1")[0].action, "purchase");
    assert.equal(store.eventsForUser("user-1")[0].source, "marketplace");
  });
});
