import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../config.js";
import { MemoryMuseStore } from "../feedback/store.js";
import { recommend } from "../pipeline.js";
import { piece, request } from "./helpers.js";

function baselineConfig(overrides = {}) {
  const config = defaultConfig();
  config.rankingPolicy = "baseline";
  config.personalization = "baseline";
  Object.assign(config, overrides);
  return config;
}

function idsOf(result) {
  return result.body.recommendations.map((outfit) => outfit.items);
}

function basic() {
  return [
    piece("top", "top"),
    piece("bottom", "bottom"),
    piece("shoes", "shoes"),
  ];
}

describe("candidate generation and ranking", () => {
  it("returns one outfit from a three-piece wardrobe", () => {
    const result = recommend(request(basic()));
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.status, "ok");
    assert.equal(result.body.recommendations.length, 1);
    assert.deepEqual(result.body.recommendations[0].items, ["top", "bottom", "shoes"]);
    assert.equal(result.body.recommendations[0].roles.top, "top");
    assert.ok(result.body.recommendations[0].reasons.length > 0);
    assert.ok(result.body.recommendations[0].score >= 0 && result.body.recommendations[0].score <= 1);
  });

  it("is deterministic for the same input", () => {
    const body = request(basic(), { weather: { temperature_c: 22 }, limit: 3 });
    const first = recommend(body);
    const second = recommend(body);
    assert.deepEqual(first.body, second.body);
  });

  it("builds a one-piece outfit without inventing a top", () => {
    const result = recommend(
      request(
        [piece("dress", "dress", { formality: "formal" }), piece("shoes", "heels", { subcategory: "heels", formality: "formal" })],
        { occasion: "formal" },
      ),
    );
    assert.deepEqual(result.body.recommendations[0].items, ["dress", "heels"]);
    assert.equal(result.body.recommendations[0].roles.one_piece, "dress");
    assert.equal(result.body.recommendations[0].roles.top, undefined);
  });

  it("returns fewer outfits when the wardrobe cannot fill a structure", () => {
    const result = recommend(request([piece("top", "top"), piece("bottom", "bottom")]));
    assert.equal(result.body.status, "insufficient_candidates");
    assert.deepEqual(result.body.recommendations, []);
  });

  it("does not pad a small result up to the limit", () => {
    const result = recommend(request(basic(), { limit: 3 }));
    assert.equal(result.body.recommendations.length, 1);
  });

  it("keeps a new user on the baseline and does not cite feedback", () => {
    const result = recommend(request(basic(), { weather: { temperature_c: 21 } }), {
      config: baselineConfig(),
    });
    assert.equal(result.body.ranking.learned_model, false);
    assert.equal(result.body.ranking.personalization, "baseline");
    assert.equal(result.body.ranking.personalization_applied, false);
    assert.equal(result.body.ranking.feedback_events, 0);
    assert.equal(result.body.ranking.feedback_applied, false);
    const text = result.body.recommendations.flatMap((outfit) => outfit.reasons).join(" ");
    assert.equal(/liked|saved|worn|learned/i.test(text), false);
  });

  it("uses the learned ranker by default without inventing feedback", () => {
    const result = recommend(request(basic(), { weather: { temperature_c: 21 } }));
    assert.equal(result.body.ranking.learned_model, true);
    assert.equal(result.body.ranking.method, "learned_mlp_ranker");
    assert.equal(result.body.ranking.feedback_applied, false);
    assert.equal(result.body.model_version, "muse-ranker-v1");
  });

  it("still recommends when color and pattern are missing", () => {
    const wardrobe = [
      { id: "top", category: "tops", subcategory: "shirt" },
      { id: "bottom", category: "bottoms", subcategory: "trousers" },
      { id: "shoes", category: "footwear", subcategory: "flats" },
    ];
    const result = recommend(request(wardrobe, { occasion: "work" }));
    assert.equal(result.body.status, "ok");
    const text = JSON.stringify(result.body.recommendations);
    assert.equal(/navy|black|white|plaid|solid/.test(text), false);
    assert.equal(result.body.recommendations[0].signals_used.includes("color_harmony"), false);
  });

  it("drops casual pieces for a formal occasion and keeps untagged pieces eligible", () => {
    const wardrobe = [
      piece("top", "hoodie", { subcategory: "hoodie", formality: "casual" }),
      piece("bottom", "jeans", { formality: "casual" }),
      piece("shoes", "sneakers", { formality: "casual" }),
      piece("top", "shirt", { subcategory: "shirt", formality: "formal", colors: { primary: "white" } }),
      piece("bottom", "trousers", { subcategory: "trousers", formality: "formal", colors: { primary: "black" } }),
      piece("shoes", "oxfords", { subcategory: "formal-shoes", formality: "formal", colors: { primary: "black" } }),
      piece("top", "untagged", { formality: undefined, colors: { primary: "grey" } }),
    ];
    const result = recommend(request(wardrobe, { occasion: "formal", limit: 5 }));
    const used = new Set(result.body.recommendations.flatMap((outfit) => outfit.items));
    assert.equal(used.has("hoodie"), false);
    assert.equal(used.has("jeans"), false);
    assert.equal(used.has("sneakers"), false);
    assert.equal(used.has("shirt"), true);
    assert.equal(used.has("untagged"), true);
  });

  it("does not apply weather rules or weather reasons when weather is absent", () => {
    const wardrobe = [
      piece("top", "top", { temperature_range_c: { min_c: 20, max_c: 35 } }),
      piece("bottom", "bottom", { temperature_range_c: { min_c: 20, max_c: 35 } }),
      piece("shoes", "shoes", { temperature_range_c: { min_c: 20, max_c: 35 } }),
    ];
    const result = recommend(request(wardrobe));
    assert.equal(result.body.status, "ok");
    assert.equal(result.body.recommendations[0].reason_codes.includes("weather"), false);
  });

  it("lets a dislike win when the same color is also a favorite", () => {
    const wardrobe = [
      piece("top", "navy-top"),
      piece("top", "white-top", { colors: { primary: "white" } }),
      piece("bottom", "bottom", { colors: { primary: "black" } }),
      piece("shoes", "shoes", { colors: { primary: "white" } }),
    ];
    const result = recommend(
      request(wardrobe, {
        profile: { favorite_colors: ["navy"], disliked_colors: ["navy"] },
        limit: 5,
      }),
    );
    const warning = result.body.warnings.find((entry) => entry.code === "conflicting_color_preference");
    assert.ok(warning);
    const used = result.body.recommendations.flatMap((outfit) => outfit.items);
    assert.equal(used.includes("navy-top"), false);
    assert.equal(used.includes("white-top"), true);
  });

  it("returns no outfits when every complete combination fails a hard rule", () => {
    const result = recommend(
      request(
        [
          piece("top", "top", { formality: "casual" }),
          piece("bottom", "bottom", { formality: "casual" }),
          piece("shoes", "shoes", { formality: "casual" }),
        ],
        { occasion: "formal" },
      ),
    );
    assert.equal(result.body.status, "insufficient_candidates");
    assert.deepEqual(result.body.recommendations, []);
  });

  it("reports an empty wardrobe without inventing garments", () => {
    const result = recommend(request([]));
    assert.equal(result.body.status, "empty_wardrobe");
    assert.deepEqual(result.body.recommendations, []);
  });

  it("matches an avoided garment id without changing its case", () => {
    const result = recommend(
      request(
        [
          piece("top", "Top-A"),
          piece("top", "Top-B"),
          piece("bottom", "bottom"),
          piece("shoes", "shoes"),
        ],
        { profile: { avoid_garment_ids: ["Top-A"] }, limit: 4 },
      ),
    );
    const used = result.body.recommendations.flatMap((outfit) => outfit.items);
    assert.equal(used.includes("Top-A"), false);
    assert.equal(used.includes("Top-B"), true);
  });

  it("skips laundry and keeps a clean outfit", () => {
    const result = recommend(
      request([
        piece("top", "dirty", { availability: "laundry" }),
        piece("top", "clean", { availability: "clean" }),
        piece("bottom", "bottom", { availability: "available" }),
        piece("shoes", "shoes"),
      ]),
    );
    const used = result.body.recommendations.flatMap((outfit) => outfit.items);
    assert.deepEqual(used, ["clean", "bottom", "shoes"]);
  });

  it("adds a coat in cold weather and leaves it off on a warm day", () => {
    const wardrobe = [
      ...basic(),
      piece("coat", "coat", { temperature_range_c: { min_c: -5, max_c: 16 }, colors: { primary: "beige" } }),
    ];
    const config = baselineConfig();
    const cold = recommend(request(wardrobe, { weather: { temperature_c: 8 }, limit: 3 }), { config });
    assert.equal(cold.body.recommendations[0].items.includes("coat"), true);
    assert.equal(cold.body.recommendations[0].reason_codes.includes("context_layer"), true);
    const warm = recommend(request(wardrobe, { weather: { temperature_c: 24 }, limit: 3 }), { config });
    const warmIds = warm.body.recommendations.flatMap((outfit) => outfit.items);
    assert.equal(warmIds.includes("coat"), false);
  });

  it("can add a tailored layer for a formal occasion without cold weather", () => {
    const result = recommend(
      request(
        [
          piece("top", "shirt", { subcategory: "shirt", formality: "formal", colors: { primary: "white" } }),
          piece("bottom", "trousers", { subcategory: "trousers", formality: "formal", colors: { primary: "black" } }),
          piece("shoes", "oxfords", { subcategory: "formal-shoes", formality: "formal", colors: { primary: "black" } }),
          piece("blazer", "blazer", { formality: "formal", colors: { primary: "navy" } }),
          piece("jacket", "denim", { formality: "casual", colors: { primary: "blue" } }),
        ],
        { occasion: "formal", weather: { temperature_c: 22 }, limit: 4 },
      ),
      { config: baselineConfig() },
    );
    assert.equal(result.body.recommendations[0].items.includes("blazer"), true);
    const used = result.body.recommendations.flatMap((outfit) => outfit.items);
    assert.equal(used.includes("denim"), false);
  });

  it("changes order when the configured weights change", () => {
    const wardrobe = [
      piece("top", "smart", { formality: "smart-casual", style_tags: ["street"] }),
      piece("top", "classic", { formality: "casual", style_tags: ["classic"] }),
      piece("bottom", "bottom"),
      piece("shoes", "shoes"),
    ];
    const body = request(wardrobe, {
      occasion: "smart-casual",
      profile: { preferred_styles: ["classic"] },
      limit: 2,
    });
    const occasionFirst = baselineConfig({
      weights: {
        occasion_match: 1,
        style_match: 0,
        garment_type_preference: 0,
        color_preference: 0,
        color_harmony: 0,
        weather_suitability: 0,
        context_layer: 0,
      },
    });
    const styleFirst = baselineConfig({
      weights: {
        occasion_match: 0,
        style_match: 1,
        garment_type_preference: 0,
        color_preference: 0,
        color_harmony: 0,
        weather_suitability: 0,
        context_layer: 0,
      },
    });
    const byOccasion = recommend(body, { config: occasionFirst });
    const byStyle = recommend(body, { config: styleFirst });
    assert.equal(byOccasion.body.recommendations[0].roles.top, "smart");
    assert.equal(byStyle.body.recommendations[0].roles.top, "classic");
  });

  it("uses likes after three events and ignores a shorter history", () => {
    const wardrobe = [
      piece("top", "top-a", { colors: { primary: "white" } }),
      piece("bottom", "bottom-a", { colors: { primary: "white" } }),
      piece("shoes", "shoes-a", { colors: { primary: "white" } }),
      piece("top", "top-b", { colors: { primary: "white" } }),
      piece("bottom", "bottom-b", { colors: { primary: "white" } }),
      piece("shoes", "shoes-b", { colors: { primary: "white" } }),
    ];
    const body = request(wardrobe, { limit: 2 });
    const config = baselineConfig();
    const seed = (action, count) => {
      const store = new MemoryMuseStore();
      for (let index = 0; index < count; index += 1) {
        store.addFeedback({
          recommendation_id: "rec-seed",
          outfit_id: "outfit-seed",
          user_id: "user-1",
          garment_ids: ["top-b", "bottom-b", "shoes-b"],
          context: { occasion: "casual", season: null, weather: null },
          action,
          reason: null,
          timestamp: "2026-01-01T00:00:00.000Z",
          model_version: "muse-v1",
        });
      }
      return store;
    };
    const none = recommend(body, { store: new MemoryMuseStore(), config });
    const two = recommend(body, { store: seed("like", 2), config });
    const three = recommend(body, { store: seed("like", 3), config });
    assert.deepEqual(idsOf(two), idsOf(none));
    assert.deepEqual(three.body.recommendations[0].items, ["top-b", "bottom-b", "shoes-b"]);
    assert.equal(three.body.recommendations[0].reason_codes.includes("feedback"), true);
    assert.equal(three.body.ranking.learned_model, false);
    assert.equal(three.body.ranking.feedback_applied, true);
  });

  it("does not drop an outfit after dismissals with no reason", () => {
    const wardrobe = [
      piece("top", "top-a"),
      piece("bottom", "bottom-a"),
      piece("shoes", "shoes-a"),
      piece("top", "top-b"),
      piece("bottom", "bottom-b"),
      piece("shoes", "shoes-b"),
    ];
    const store = new MemoryMuseStore();
    for (let index = 0; index < 3; index += 1) {
      store.addFeedback({
        recommendation_id: "rec-seed",
        outfit_id: "outfit-seed",
        user_id: "user-1",
        garment_ids: ["top-b", "bottom-b", "shoes-b"],
        context: { occasion: "casual", season: null, weather: null },
        action: "dismiss",
        reason: null,
        timestamp: "2026-01-02T00:00:00.000Z",
        model_version: "muse-v1",
      });
    }
    const result = recommend(request(wardrobe, { limit: 8 }), { store, config: baselineConfig() });
    const pure = result.body.recommendations.find(
      (outfit) => outfit.items.includes("top-b") && outfit.items.includes("bottom-b") && outfit.items.includes("shoes-b"),
    );
    const untouched = result.body.recommendations.find(
      (outfit) => outfit.items.includes("top-a") && outfit.items.includes("bottom-a") && outfit.items.includes("shoes-a"),
    );
    assert.ok(pure);
    assert.ok(untouched.score >= pure.score);
    const text = result.body.recommendations.flatMap((outfit) => outfit.reasons).join(" ");
    assert.equal(/liked, saved, or worn/.test(text), false);
    assert.equal(result.body.ranking.learned_model, false);
  });

  it("spreads recommendations across different garments", () => {
    const wardrobe = [];
    for (const id of ["top-a", "top-b"]) wardrobe.push(piece("top", id));
    for (const id of ["bottom-a", "bottom-b"]) wardrobe.push(piece("bottom", id));
    for (const id of ["shoe-a", "shoe-b"]) wardrobe.push(piece("shoes", id));
    const result = recommend(request(wardrobe, { limit: 3 }));
    const tops = new Set(result.body.recommendations.map((outfit) => outfit.roles.top));
    assert.ok(tops.size >= 2);
    for (const outfit of result.body.recommendations) {
      assert.equal(new Set(outfit.items).size, outfit.items.length);
    }
  });

  it("allows LinUCB personalization mode without requiring a prebuilt model", () => {
    const config = defaultConfig();
    config.personalization = "linucb";
    const result = recommend(request(basic()), { config, store: new MemoryMuseStore() });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.ranking.personalization, "linucb");
    assert.equal(result.body.ranking.personalization_applied, false);
  });

  it("caps a large wardrobe deterministically", () => {
    const config = baselineConfig({ maxCandidates: 4, slotBeam: 2 });
    const wardrobe = [];
    for (let index = 1; index <= 9; index += 1) wardrobe.push(piece("top", `top-0${index}`));
    wardrobe.push(piece("bottom", "bottom-01"), piece("bottom", "bottom-02"));
    wardrobe.push(piece("shoes", "shoe-01"), piece("shoes", "shoe-02"));
    const body = request(wardrobe, { limit: 3 });
    const first = recommend(body, { config });
    const second = recommend(body, { config });
    assert.deepEqual(first.body, second.body);
    const tops = new Set(first.body.recommendations.map((outfit) => outfit.roles.top));
    assert.ok([...tops].every((id) => id === "top-01" || id === "top-02"));
  });
});
