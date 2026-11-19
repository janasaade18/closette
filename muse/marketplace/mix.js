/**
 * Closet-first marketplace mix.
 * Prefer complete wardrobe outfits. Marketplace only fills missing roles
 * (or completes looks when the closet cannot), never replaces owned pieces.
 */
import { generateCandidates, makeOutfit } from "../candidate_generation/generate.js";

const FORMALITY_RANK = {
  athletic: 0,
  casual: 1,
  "smart-casual": 2,
  work: 3,
  formal: 4,
};

function cloneOutfitMeta(outfit, marketplaceIds) {
  return {
    ...outfit,
    mixed: marketplaceIds.length > 0,
    marketplace_ids: marketplaceIds,
    item_sources: Object.fromEntries(
      outfit.items.map((item) => [item.id, item.source === "marketplace" ? "marketplace" : "wardrobe"]),
    ),
  };
}

function marketplaceIdsOf(outfit) {
  return outfit.items.filter((item) => item.source === "marketplace").map((item) => item.id);
}

function withMarketplaceFlags(outfits) {
  return outfits.map((outfit) => cloneOutfitMeta(outfit, marketplaceIdsOf(outfit)));
}

function coreFormalityBias(items) {
  const core = items.filter((item) =>
    ["top", "bottom", "one_piece", "footwear"].includes(item.role),
  );
  const ranks = core
    .map((item) => FORMALITY_RANK[item.formality])
    .filter((value) => value != null);
  if (!ranks.length) return null;
  return ranks.reduce((sum, value) => sum + value, 0) / ranks.length;
}

/** Marketplace piece must sit within one formality step of the closet core. */
export function productFitsOutfitCore(base, product) {
  if (!product?.role) return false;
  const bias = coreFormalityBias(base.items ?? []);
  const productRank = FORMALITY_RANK[product.formality];
  if (bias != null && productRank != null && Math.abs(productRank - bias) > 1.01) {
    return false;
  }
  const top = (base.items ?? []).find((item) => item.role === "top");
  const bottom = (base.items ?? []).find((item) => item.role === "bottom");
  const casualTop = ["t-shirt", "hoodie", "sweatshirt", "tank-top"].includes(top?.subcategory);
  const casualBottom = bottom?.subcategory === "jeans" || bottom?.formality === "casual";
  if (
    product.role === "outerwear" &&
    (product.subcategory === "blazer" || product.formality === "formal" || product.formality === "work") &&
    casualTop &&
    casualBottom
  ) {
    return false;
  }
  return true;
}

/** Fill a role the wardrobe outfit is missing — never replace an owned piece. */
function fillMissingRole(base, product) {
  if (!product.role || base.roles[product.role]) return null;
  if (!productFitsOutfitCore(base, product)) return null;
  const roleMap = {};
  for (const item of base.items) roleMap[item.role] = item;
  roleMap[product.role] = product;
  return makeOutfit(roleMap);
}

/**
 * Build candidates: wardrobe-only first; marketplace only as gap-fill.
 */
export function generateMixedCandidates(wardrobeItems, marketplaceProducts, context, profile, config) {
  const wardrobeOnly = withMarketplaceFlags(generateCandidates(wardrobeItems, context, profile, config));
  if (!marketplaceProducts.length || config.marketplaceEnabled === false) {
    return { wardrobeOnly, mixed: [], all: wardrobeOnly };
  }

  const maxPerOutfit = config.marketplaceMaxItemsPerOutfit ?? 1;
  const maxMixed = config.marketplaceMaxMixedCandidates ?? Math.min(120, config.maxCandidates);
  const mixed = [];
  const seen = new Set(wardrobeOnly.map((outfit) => outfit.outfitId));

  const push = (outfit) => {
    if (!outfit || seen.has(outfit.outfitId) || mixed.length >= maxMixed) return;
    const ids = marketplaceIdsOf(outfit);
    if (!ids.length || ids.length > maxPerOutfit) return;
    seen.add(outfit.outfitId);
    mixed.push(cloneOutfitMeta(outfit, ids));
  };

  // Closet can complete looks → only optional gap-fill (missing outerwear / accessory / etc.).
  if (wardrobeOnly.length) {
    const bases = wardrobeOnly.slice(0, Math.min(40, wardrobeOnly.length));
    for (const product of marketplaceProducts) {
      for (const base of bases) {
        if (mixed.length >= maxMixed) break;
        push(fillMissingRole(base, product));
      }
    }
  } else {
    // Closet cannot form a full outfit — allow marketplace to complete missing roles.
    const pool = [...wardrobeItems, ...marketplaceProducts];
    const completed = withMarketplaceFlags(generateCandidates(pool, context, profile, config));
    for (const outfit of completed) {
      if (!outfit.marketplace_ids?.length) continue;
      if (outfit.marketplace_ids.length > maxPerOutfit) continue;
      // Drop mixes that clash with whatever wardrobe pieces are present.
      const wardrobePieces = outfit.items.filter((item) => item.source !== "marketplace");
      const marketPieces = outfit.items.filter((item) => item.source === "marketplace");
      if (
        wardrobePieces.length &&
        marketPieces.some((product) => !productFitsOutfitCore({ items: wardrobePieces, roles: {} }, product))
      ) {
        continue;
      }
      push(outfit);
    }
  }

  mixed.sort((a, b) => a.outfitId.localeCompare(b.outfitId));
  // Closet-first ordering: wardrobe outfits lead; market gap-fills trail for the ranker.
  const all = [...wardrobeOnly, ...mixed];
  return { wardrobeOnly, mixed, all: all.slice(0, config.maxCandidates) };
}

export function summarizeMarketplaceUsage(outfits) {
  const used = new Set();
  let mixedCount = 0;
  for (const outfit of outfits) {
    if (outfit.marketplace_ids?.length) {
      mixedCount += 1;
      for (const id of outfit.marketplace_ids) used.add(id);
    }
  }
  return { mixed_outfits: mixedCount, product_ids: [...used].sort() };
}

export function publicMarketplaceItems(outfit) {
  return (outfit.items ?? [])
    .filter((item) => item.source === "marketplace")
    .map((item) => ({
      product_id: item.productId ?? item.id,
      role: item.role,
      category: item.category,
      subcategory: item.subcategory,
      name: item.name ?? null,
      price: item.price,
      currency: item.currency ?? "USD",
      brand: item.brand,
      sizes: item.sizes ?? [],
      colors: item.colors,
      image_url: item.imageUrl ?? null,
    }));
}

/** Buy suggestions that are not already worn in the selected outfits. */
export function publicBuySuggestions(retrieved, selectedOutfits, limit = 6) {
  const worn = new Set();
  for (const outfit of selectedOutfits ?? []) {
    for (const id of outfit.marketplace_ids ?? []) worn.add(id);
  }
  const out = [];
  for (const row of retrieved ?? []) {
    const product = row.product;
    if (!product?.id || worn.has(product.id)) continue;
    out.push({
      product_id: product.productId ?? product.id,
      role: product.role,
      category: product.category,
      subcategory: product.subcategory,
      name: product.name ?? null,
      price: product.price,
      currency: product.currency ?? "USD",
      brand: product.brand,
      sizes: product.sizes ?? [],
      colors: product.colors,
      image_url: product.imageUrl ?? null,
      reason: "Pairs with looks from your closet",
      score: row.score,
    });
    if (out.length >= limit) break;
  }
  return out;
}
