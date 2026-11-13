import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../config.js";
import { MemoryMuseStore } from "../feedback/store.js";
import { recommend } from "../pipeline.js";
import { planTravel } from "../travel/pack.js";
import { piece, request } from "./helpers.js";

function tripWardrobe() {
  return [
    piece("top", "tee-1", { formality: "casual", colors: { primary: "white" } }),
    piece("top", "tee-2", { formality: "casual", colors: { primary: "navy" } }),
    piece("top", "shirt-1", { subcategory: "shirt", formality: "formal", colors: { primary: "white" } }),
    piece("bottom", "jeans-1", { formality: "casual", colors: { primary: "blue" } }),
    piece("bottom", "trouser-1", { subcategory: "trousers", formality: "formal", colors: { primary: "black" } }),
    piece("shoes", "sneaker-1", { formality: "casual", colors: { primary: "white" } }),
    piece("shoes", "oxford-1", { subcategory: "formal-shoes", formality: "formal", colors: { primary: "black" } }),
    piece("blazer", "blazer-1", { formality: "formal", colors: { primary: "navy" } }),
    piece("coat", "coat-1", {
      formality: "smart-casual",
      colors: { primary: "beige" },
      temperature_range_c: { min_c: -5, max_c: 14 },
    }),
    piece("bag", "bag-1", { formality: "casual", colors: { primary: "brown" } }),
  ];
}

const market = [
  {
    id: "mkt-scarf-travel",
    category: "accessories",
    subcategory: "scarf",
    colors: { primary: "olive" },
    formality: "casual",
    price: 40,
    sizes: ["OS"],
    in_stock: true,
    temperature_range_c: { min_c: -5, max_c: 16 },
  },
];

describe("phase 4 travel packing", () => {
  it("leaves single-day recommend behavior unchanged", () => {
    const wardrobe = [
      piece("top", "tee-1", { formality: "casual", colors: { primary: "white" } }),
      piece("bottom", "jeans-1", { formality: "casual", colors: { primary: "blue" } }),
      piece("shoes", "sneaker-1", { formality: "casual", colors: { primary: "white" } }),
    ];
    const body = request(wardrobe, { weather: { temperature_c: 22 }, limit: 1 });
    const result = recommend(body, { config: defaultConfig(), store: new MemoryMuseStore() });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.recommendations.length, 1);
    assert.equal(result.body.day_plans, undefined);
  });

  it("builds a multi-day plan with day-specific weather and occasions", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    const result = planTravel(
      {
        user_id: "user-1",
        destination: { name: "Lisbon", country: "PT" },
        wardrobe: tripWardrobe(),
        trip: {
          start_date: "2026-06-01",
          days: [
            { date: "2026-06-01", occasion: "casual", weather: { temperature_c: 24 } },
            { date: "2026-06-02", occasion: "formal", weather: { temperature_c: 17 } },
            { date: "2026-06-03", occasion: "casual", weather: { temperature_c: 11 } },
          ],
        },
        luggage: { max_items: 14, prefer_rewear: true, max_core_reuses: 1 },
        candidates_per_day: 4,
      },
      { config, store: new MemoryMuseStore() },
    );
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.model_version, "muse-travel-v1");
    assert.equal(result.body.day_plans.length, 3);
    assert.ok(result.body.day_plans.every((day) => day.status === "ok"));
    assert.equal(result.body.day_plans[0].occasion, "casual");
    assert.equal(result.body.day_plans[1].occasion, "formal");
    assert.ok(result.body.packing_list.length >= 3);
    assert.ok(result.body.luggage.unique_items >= 3);
  });

  it("rotates cores so the same full look is not repeated every day", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    const result = planTravel(
      {
        user_id: "user-1",
        wardrobe: tripWardrobe(),
        trip: {
          days: [
            { date: "d1", occasion: "casual", weather: { temperature_c: 22 } },
            { date: "d2", occasion: "casual", weather: { temperature_c: 22 } },
            { date: "d3", occasion: "casual", weather: { temperature_c: 22 } },
          ],
        },
        luggage: { max_core_reuses: 0, prefer_rewear: false },
        candidates_per_day: 5,
      },
      { config },
    );
    const cores = result.body.day_plans.map((day) => JSON.stringify(day.outfit.items));
    assert.equal(new Set(cores).size >= 2, true);
  });

  it("optimizes luggage toward max_items and can include marketplace suggestions", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    const result = planTravel(
      {
        user_id: "user-1",
        wardrobe: tripWardrobe(),
        trip: {
          days: [
            { date: "d1", occasion: "casual", weather: { temperature_c: 10 } },
            { date: "d2", occasion: "formal", weather: { temperature_c: 12 } },
          ],
        },
        luggage: { max_items: 10, max_weight_kg: 9 },
        marketplace: { enabled: true, budget_max: 80, include_mixed: true },
        marketplace_products: market,
        candidates_per_day: 4,
      },
      { config },
    );
    assert.equal(result.statusCode, 200);
    assert.ok(result.body.luggage.unique_items <= 12);
    assert.ok(Array.isArray(result.body.marketplace_suggestions));
  });

  it("rejects trips without days", () => {
    const result = planTravel({ user_id: "user-1", wardrobe: tripWardrobe(), trip: { days: [] } });
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error, "invalid_travel_request");
  });
});
