# Marketplace intelligence (Phase 3)

Muse can recommend **marketplace products** that complement a wardrobe, build **mixed outfits** (wardrobe + catalog), and filter by **budget / size / availability / weather**.

This is **structured retrieval + scoring**, not RAG and not Qwen/QLoRA.

## Request

```json
{
  "user_id": "user-1",
  "wardrobe": [ ... ],
  "marketplace": {
    "enabled": true,
    "budget_max": 120,
    "budget_min": 20,
    "sizes": ["M", "32"],
    "include_mixed": true,
    "max_products": 24
  },
  "marketplace_products": [ ... ]
}
```

`marketplace_products` is an inline catalog. Otherwise the server uses `deps.marketplaceCatalog` or `marketplace_catalog_path` from runtime config.

## Flow

1. Filter catalog with `constraints.js`
2. Rank complements with `retrieve.js` (slot need, color harmony, occasion, price fit, weather)
3. Build wardrobe-only and mixed candidates with `mix.js`
4. Apply existing hard rules + Phase 1/2 ranking
5. Marketplace purchases/likes continue to train Phase 2 LinUCB; `affinity.js` adds a marketplace-specific nudge

## Learning

Feedback already supports `action: "purchase"`, `source: "marketplace"`, and `product_ids`. Phase 3 stores those on recommendation snapshots that include marketplace items so personalization keeps learning from checkout-style events.
