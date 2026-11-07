import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../config.js";
import { normalizeGarment } from "../schemas/garment.js";
import { RULE, itemViolations, outfitViolations } from "../compatibility_rules/rules.js";
import { recommend } from "../pipeline.js";
import { piece, request } from "./helpers.js";

const config = defaultConfig();
const profile = {
  preferredStyles: [],
  favoriteColors: [],
  dislikedColors: [],
  preferredGarmentTypes: [],
  explicitPreferences: [],
  avoidGarmentIds: [],
  avoidSubcategories: [],
  avoidCategories: [],
};

function judge(raw, context = {}, customProfile = profile, customConfig = config) {
  return itemViolations(normalizeGarment(raw), context, customProfile, customConfig);
}

describe("hard rules", () => {
  it("keeps a garment when metadata is missing", () => {
    const reasons = judge({ id: "shirt-1", category: "tops" });
    assert.deepEqual(reasons, []);
  });

  it("does not invent a category for an unknown subcategory", () => {
    assert.deepEqual(judge({ id: "x", subcategory: "cape" }), [RULE.missingCategory]);
  });

  it("fills a missing category from the taxonomy", () => {
    const item = normalizeGarment({ id: "tee", subcategory: "t-shirt" });
    assert.equal(item.category, "tops");
    assert.deepEqual(itemViolations(item, {}, profile, config), []);
  });

  it("rejects an unknown category and a category that contradicts the subcategory", () => {
    assert.ok(judge({ id: "a", category: "cape" }).includes(RULE.unknownCategory));
    assert.ok(
      judge({ id: "b", category: "bottoms", subcategory: "t-shirt" }).includes(RULE.categoryMismatch),
    );
  });

  it("removes unavailable and laundry items and keeps unknown availability", () => {
    assert.ok(judge({ id: "a", category: "tops", availability: "unavailable" }).includes(RULE.unavailable));
    assert.ok(judge({ id: "b", category: "tops", availability: "in laundry" }).includes(RULE.unavailable));
    assert.deepEqual(judge({ id: "c", category: "tops", availability: "clean" }), []);
    assert.deepEqual(judge({ id: "d", category: "tops", availability: "available" }), []);
    assert.deepEqual(judge({ id: "e", category: "tops", availability: "needs-repair" }), []);
  });

  it("applies explicit avoid lists and a disliked primary color", () => {
    const custom = {
      ...profile,
      avoidGarmentIds: ["a"],
      avoidCategories: ["outerwear"],
      avoidSubcategories: ["heels"],
      dislikedColors: ["pink"],
    };
    assert.ok(judge({ id: "a", category: "tops" }, {}, custom).includes(RULE.avoidGarment));
    assert.ok(judge({ id: "b", category: "outerwear", subcategory: "coat" }, {}, custom).includes(RULE.avoidCategory));
    assert.ok(judge({ id: "c", category: "footwear", subcategory: "heels" }, {}, custom).includes(RULE.avoidSubcategory));
    assert.ok(
      judge({ id: "d", category: "tops", colors: { primary: "pink" } }, {}, custom).includes(RULE.dislikedColor),
    );
    assert.deepEqual(
      judge({ id: "e", category: "tops", colors: { secondary: ["pink"] } }, {}, custom),
      [],
    );
    assert.deepEqual(judge({ id: "f", category: "tops" }, {}, custom), []);
  });

  it("uses occasion formality only when both sides are known", () => {
    assert.ok(
      judge({ id: "a", category: "tops", formality: "casual" }, { occasion: "formal" }).includes(RULE.occasionFormality),
    );
    assert.deepEqual(judge({ id: "b", category: "tops" }, { occasion: "formal" }), []);
    assert.deepEqual(judge({ id: "c", category: "tops", formality: "formal" }, { occasion: "formal" }), []);
    assert.ok(
      judge({ id: "d", category: "tops", formality: "formal" }, { occasion: "casual" }).includes(RULE.occasionFormality),
    );
    assert.ok(
      judge({ id: "e", category: "tops", formality: "athletic" }, { occasion: "work" }).includes(RULE.occasionFormality),
    );
    assert.deepEqual(judge({ id: "f", category: "tops", formality: "casual" }, { occasion: "work" }), []);
    assert.deepEqual(judge({ id: "g", category: "tops", formality: "casual" }, { occasion: "picnic" }), []);
  });

  it("applies temperature, season, and condition only with garment evidence", () => {
    const cold = { weather: { temperature_c: 5, condition: null } };
    const mild = { weather: { temperature_c: 22, condition: "rain" } };
    assert.ok(
      judge({ id: "a", category: "tops", temperature_range_c: { min_c: 16, max_c: 30 } }, cold).includes(
        RULE.temperatureRange,
      ),
    );
    assert.deepEqual(judge({ id: "b", category: "tops", temperature_range_c: { min_c: 16, max_c: 30 } }, mild), []);
    assert.deepEqual(judge({ id: "c", category: "tops" }, cold), []);
    assert.deepEqual(
      judge({ id: "d", category: "tops", temperature_range_c: { min_c: 10, max_c: 20 } }, { weather: null }),
      [],
    );
    assert.ok(
      judge({ id: "e", category: "tops", seasons: ["summer"] }, { season: "winter" }).includes(RULE.season),
    );
    assert.deepEqual(judge({ id: "f", category: "tops" }, { season: "winter" }), []);
    assert.ok(
      judge(
        { id: "g", category: "footwear", subcategory: "sandals", unsuitable_conditions: ["rain"] },
        mild,
      ).includes(RULE.unsuitableCondition),
    );
    assert.deepEqual(judge({ id: "h", category: "footwear", subcategory: "sandals" }, mild), []);
  });

  it("does not treat style, pattern, or color pairs as hard rules", () => {
    assert.equal(config.rules.color_clash_is_hard_rule, false);
    assert.equal(config.rules.style_preference_is_hard_rule, false);
    assert.equal(config.rules.dismissal_is_hard_rule, false);
    assert.deepEqual(
      judge(
        { id: "a", category: "tops", pattern: "plaid", colors: { primary: "red" }, style_tags: ["street"] },
        { occasion: "casual" },
        { ...profile, preferredStyles: ["classic"] },
      ),
      [],
    );
    const result = recommend(
      request([
        piece("top", "top", { pattern: "plaid", colors: { primary: "red" } }),
        piece("bottom", "bottom", { pattern: "striped", colors: { primary: "green" } }),
        piece("shoes", "shoes", { colors: { primary: "white" } }),
      ]),
    );
    assert.equal(result.body.status, "ok");
    assert.deepEqual(result.body.recommendations[0].items.sort(), ["bottom", "shoes", "top"]);
  });

  it("rejects duplicate garments and explicit incompatibility", () => {
    assert.deepEqual(
      outfitViolations({
        items: [
          { id: "a", subcategory: null, category: "tops", incompatibleWith: [] },
          { id: "a", subcategory: null, category: "bottoms", incompatibleWith: [] },
        ],
      }),
      [RULE.duplicateGarment],
    );
    assert.ok(
      outfitViolations({
        items: [
          { id: "top", subcategory: "shirt", category: "tops", incompatibleWith: ["jeans"] },
          { id: "bottom", subcategory: "jeans", category: "bottoms", incompatibleWith: [] },
        ],
      }).includes(RULE.explicitIncompatibility),
    );
  });
});
