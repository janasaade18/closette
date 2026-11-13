import test from "node:test";
import assert from "node:assert/strict";
import { recommend } from "../pipeline.js";
import { defaultConfig } from "../config.js";
import { loadLearnedModel, scoreLearnedVector, buildLearnedVector } from "../ranking/learned.js";
import { MemoryMuseStore } from "../feedback/store.js";

const wardrobe = [
  {
    id: "item-001",
    category: "tops",
    subcategory: "t-shirt",
    colors: { primary: "navy" },
    formality: "casual",
    style_tags: ["minimal"],
  },
  {
    id: "item-002",
    category: "bottoms",
    subcategory: "jeans",
    colors: { primary: "blue" },
    formality: "casual",
  },
  {
    id: "item-003",
    category: "footwear",
    subcategory: "sneakers",
    colors: { primary: "white" },
    formality: "casual",
  },
];

test("learned MLP scores a feature vector in [0, 1]", () => {
  const model = loadLearnedModel();
  assert.ok(model, "ranker-v1.json should exist under ml/muse/weights");
  const vector = buildLearnedVector(
    {
      occasion_match: 0.9,
      style_match: 0.8,
      garment_type_preference: 0.5,
      color_preference: 0.7,
      color_harmony: 0.9,
      weather_suitability: 0.8,
      context_layer: null,
    },
    { occasion: "casual", season: "summer", weather: { temperature_c: 24 } },
    { roles: { top: "a", bottom: "b", footwear: "c" }, itemIds: ["a", "b", "c"] },
  );
  const score = scoreLearnedVector(model, vector);
  assert.ok(score >= 0 && score <= 1);
});

test("recommend marks learned_model when ranking_policy is learned", () => {
  const model = loadLearnedModel();
  assert.ok(model);
  const config = defaultConfig();
  config.rankingPolicy = "learned";
  const result = recommend(
    {
      user_id: "user-learned",
      occasion: "casual",
      weather: { temperature_c: 22 },
      limit: 2,
      wardrobe,
    },
    { config, store: new MemoryMuseStore(), learnedModel: model },
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ranking.learned_model, true);
  assert.equal(result.body.ranking.method, "learned_mlp_ranker");
  assert.equal(result.body.model_version, "muse-ranker-v1");
  assert.ok(result.body.recommendations.length >= 1);
});
