import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../config.js";
import { recommend } from "../pipeline.js";
import { piece, request } from "./helpers.js";

describe("weather suitability messaging", () => {
  it("rejects a summer-only wardrobe on a cold day", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    config.marketplaceEnabled = false;
    const result = recommend(
      request(
        [
          piece("top", "tee", { subcategory: "t-shirt", formality: "casual" }),
          piece("bottom", "shorts", { subcategory: "shorts", formality: "casual" }),
          piece("shoes", "sandals", { subcategory: "sandals", formality: "casual" }),
        ],
        { weather: { temperature_c: 6 }, limit: 3 },
      ),
      { config },
    );
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.status, "weather_unsuitable");
    assert.equal(result.body.recommendations.length, 0);
    assert.match(result.body.message, /not recommended/i);
    assert.match(result.body.message, /cold/i);
    assert.ok(result.body.excluded_items.some((row) => row.rules.includes("temperature_range")));
  });

  it("rejects a winter-coat wardrobe on a hot day", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    config.marketplaceEnabled = false;
    const result = recommend(
      request(
        [
          piece("top", "sweater", { subcategory: "sweater", formality: "casual" }),
          piece("bottom", "jeans", { subcategory: "jeans", formality: "casual" }),
          piece("shoes", "boots", { subcategory: "boots", formality: "casual" }),
          piece("coat", "coat", {
            subcategory: "coat",
            formality: "smart-casual",
            temperature_range_c: { min_c: -10, max_c: 12 },
          }),
        ],
        { weather: { temperature_c: 30 }, limit: 3 },
      ),
      { config },
    );
    assert.equal(result.body.status, "weather_unsuitable");
    assert.equal(result.body.recommendations.length, 0);
    assert.match(result.body.message, /not recommended/i);
    assert.match(result.body.message, /hot/i);
  });

  it("flags cold looks without a coat as a compromise", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    config.marketplaceEnabled = false;
    const result = recommend(
      request(
        [
          piece("top", "tee", { subcategory: "t-shirt", formality: "casual" }),
          piece("bottom", "jeans", { subcategory: "jeans", formality: "casual" }),
          piece("shoes", "sneakers", { subcategory: "sneakers", formality: "casual" }),
        ],
        { weather: { temperature_c: 6 }, limit: 2 },
      ),
      { config },
    );
    assert.equal(result.body.status, "weather_compromise");
    assert.ok(result.body.recommendations.length >= 1);
    assert.match(result.body.message, /not recommended|cold/i);
  });

  it("keeps a coat in the top look on a cold day when available", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    config.marketplaceEnabled = false;
    const result = recommend(
      request(
        [
          piece("top", "tee", { subcategory: "t-shirt", formality: "casual" }),
          piece("bottom", "jeans", { subcategory: "jeans", formality: "casual" }),
          piece("shoes", "sneakers", { subcategory: "sneakers", formality: "casual" }),
          piece("coat", "coat", {
            subcategory: "coat",
            formality: "smart-casual",
            colors: { primary: "beige" },
            temperature_range_c: { min_c: -5, max_c: 14 },
          }),
        ],
        { weather: { temperature_c: 8 }, limit: 3 },
      ),
      { config },
    );
    assert.ok(["ok", "weather_compromise"].includes(result.body.status));
    assert.ok(
      result.body.recommendations.some((outfit) => outfit.items.includes("coat")),
      "expected a cold-day recommendation that includes the coat",
    );
    assert.ok(result.body.recommendations[0].items.includes("coat"));
  });

  it("recommends summer pieces on a hot day", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    config.marketplaceEnabled = false;
    const result = recommend(
      request(
        [
          piece("top", "tee", { subcategory: "t-shirt", formality: "casual" }),
          piece("bottom", "shorts", { subcategory: "shorts", formality: "casual" }),
          piece("shoes", "sandals", { subcategory: "sandals", formality: "casual" }),
        ],
        { weather: { temperature_c: 30 }, limit: 2 },
      ),
      { config },
    );
    assert.equal(result.body.status, "ok");
    assert.ok(result.body.recommendations.length >= 1);
  });
});
