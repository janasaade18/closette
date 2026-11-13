import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../config.js";
import { MemoryMuseStore } from "../feedback/store.js";
import { filterMarketplaceProducts } from "../marketplace/constraints.js";
import { MemoryMarketplaceCatalog } from "../marketplace/catalog.js";
import { normalizeMarketplaceProduct } from "../marketplace/normalize.js";
import { retrieveComplements } from "../marketplace/retrieve.js";
import { recommend } from "../pipeline.js";
import { piece, request } from "./helpers.js";

const catalog = [
  {
    id: "mkt-sneaker-01",
    category: "footwear",
    subcategory: "sneakers",
    colors: { primary: "white" },
    formality: "casual",
    price: 78,
    sizes: ["42"],
    in_stock: true,
    temperature_range_c: { min_c: 8, max_c: 34 },
  },
  {
    id: "mkt-blazer-01",
    category: "outerwear",
    subcategory: "blazer",
    colors: { primary: "navy" },
    formality: "work",
    price: 160,
    sizes: ["M"],
    in_stock: true,
    temperature_range_c: { min_c: 5, max_c: 22 },
  },
  {
    id: "mkt-soldout-01",
    category: "tops",
    subcategory: "hoodie",
    colors: { primary: "grey" },
    formality: "casual",
    price: 60,
    sizes: ["M"],
    in_stock: false,
    availability: "sold_out",
  },
  {
    id: "mkt-expensive-01",
    category: "outerwear",
    subcategory: "coat",
    colors: { primary: "black" },
    formality: "formal",
    price: 480,
    sizes: ["M"],
    in_stock: true,
    temperature_range_c: { min_c: -10, max_c: 10 },
  },
];

function wardrobe() {
  return [
    piece("top", "top-a", { formality: "casual", colors: { primary: "navy" } }),
    piece("bottom", "bottom-a", { formality: "casual", colors: { primary: "blue" } }),
    piece("shoes", "shoes-a", { formality: "casual", colors: { primary: "white" } }),
  ];
}

describe("phase 3 marketplace intelligence", () => {
  it("filters by budget, size, and availability", () => {
    const products = catalog.map((row) => normalizeMarketplaceProduct(row));
    const { accepted, rejected } = filterMarketplaceProducts(
      products,
      { budgetMax: 100, sizes: ["42"], requireInStock: true },
      { weather: { temperature_c: 20 } },
      defaultConfig(),
    );
    const ids = accepted.map((product) => product.id);
    assert.ok(ids.includes("mkt-sneaker-01"));
    assert.equal(ids.includes("mkt-expensive-01"), false);
    assert.equal(ids.includes("mkt-soldout-01"), false);
    assert.ok(rejected.some((row) => row.reason === "over_budget" || row.reason === "out_of_stock"));
  });

  it("retrieves complements for a wardrobe", () => {
    const products = catalog.map((row) => normalizeMarketplaceProduct(row)).filter((row) => row.inStock);
    const ranked = retrieveComplements(
      products,
      wardrobe().map((row) => ({ ...row, role: row.category === "tops" ? "top" : row.category === "bottoms" ? "bottom" : "footwear", colors: row.colors })),
      { occasion: "casual", weather: { temperature_c: 18 } },
      { budgetMax: 200 },
      5,
    );
    assert.ok(ranked.length >= 1);
    assert.ok(ranked[0].score >= ranked[ranked.length - 1].score);
  });

  it("returns mixed wardrobe + marketplace outfits when enabled", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    const result = recommend(
      request(wardrobe(), {
        limit: 5,
        weather: { temperature_c: 12 },
        occasion: "work",
        marketplace: { enabled: true, budget_max: 200, sizes: ["M", "42"], include_mixed: true },
        marketplace_products: catalog,
      }),
      { config, store: new MemoryMuseStore() },
    );
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.ranking.marketplace_enabled, true);
    assert.ok(result.body.ranking.marketplace_products_considered >= 1);
    const mixed = result.body.recommendations.filter((outfit) => outfit.mixed);
    assert.ok(mixed.length >= 1);
    assert.ok(mixed.some((outfit) => outfit.marketplace_items.length >= 1));
    assert.ok(mixed.some((outfit) => outfit.reason_codes.includes("marketplace")));
  });

  it("respects budget so expensive coats drop out", () => {
    const config = defaultConfig();
    config.personalization = "baseline";
    const result = recommend(
      request(wardrobe(), {
        limit: 8,
        weather: { temperature_c: 6 },
        marketplace: { enabled: true, budget_max: 100, include_mixed: true },
        marketplace_products: catalog,
      }),
      { config },
    );
    const used = result.body.recommendations.flatMap((outfit) => outfit.marketplace_items.map((item) => item.product_id));
    assert.equal(used.includes("mkt-expensive-01"), false);
    assert.ok(result.body.marketplace_excluded.some((row) => row.id === "mkt-expensive-01"));
  });

  it("learns from marketplace purchase feedback on mixed outfits", () => {
    const store = new MemoryMuseStore();
    const config = defaultConfig();
    config.personalization = "linucb";
    const body = request(wardrobe(), {
      limit: 3,
      weather: { temperature_c: 12 },
      occasion: "work",
      marketplace: { enabled: true, budget_max: 200, sizes: ["M"], include_mixed: true },
      marketplace_products: catalog,
    });
    const first = recommend(body, { config, store });
    const mixed = first.body.recommendations.find((outfit) => outfit.mixed) ?? first.body.recommendations[0];
    assert.ok(mixed);
    for (let index = 0; index < 3; index += 1) {
      store.addFeedback({
        recommendation_id: first.body.recommendation_id,
        outfit_id: mixed.outfit_id,
        user_id: "user-1",
        garment_ids: [...mixed.items],
        product_ids: mixed.marketplace_items.map((item) => item.product_id),
        context: { occasion: "work", season: null, weather: { temperature_c: 12 } },
        action: "purchase",
        reason: null,
        source: "marketplace",
        features: store.getRecommendation(first.body.recommendation_id).shown.find((row) => row.outfit_id === mixed.outfit_id)
          ?.features,
        timestamp: `2026-08-0${index + 1}T12:00:00.000Z`,
        model_version: first.body.model_version,
      });
    }
    const second = recommend(body, { config, store });
    assert.equal(second.statusCode, 200);
    assert.ok(
      second.body.recommendations.some(
        (outfit) => outfit.signals_used.includes("marketplace_affinity") || outfit.signals_used.includes("linucb_personalization"),
      ),
    );
  });

  it("loads the demo fixture catalog through MemoryMarketplaceCatalog", () => {
    const loaded = new MemoryMarketplaceCatalog(catalog);
    assert.equal(loaded.list().every((product) => product.source === "marketplace"), true);
  });
});
