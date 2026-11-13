/**
 * Build mixed outfits: wardrobe pieces + marketplace products.
 * Candidate generation structures stay the same; only the item pool expands.
 */
import { generateCandidates, makeOutfit } from "../candidate_generation/generate.js";
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

/**
 * Replace one wardrobe role with a marketplace product, keeping other wardrobe roles.
 */
function substituteRole(base, product) {
  if (!product.role || !base.roles[product.role]) return null;
  const roleMap = {};
  for (const item of base.items) roleMap[item.role] = item;
  roleMap[product.role] = product;
  return makeOutfit(roleMap);
}

function addOptionalRole(base, product) {
  if (!product.role || (product.role !== "outerwear" && product.role !== "accessory")) return null;
  if (base.roles[product.role]) return null;
  const roleMap = {};
  for (const item of base.items) roleMap[item.role] = item;
  roleMap[product.role] = product;
  return makeOutfit(roleMap);
}

export function generateMixedCandidates(wardrobeItems, marketplaceProducts, context, profile, config) {
  const wardrobeOnly = withMarketplaceFlags(generateCandidates(wardrobeItems, context, profile, config));
  if (!marketplaceProducts.length || config.marketplaceEnabled === false) {
    return { wardrobeOnly, mixed: [], all: wardrobeOnly };
  }

  const maxPerOutfit = config.marketplaceMaxItemsPerOutfit ?? 1;
  const maxMixed = config.marketplaceMaxMixedCandidates ?? Math.min(120, config.maxCandidates);
  const pool = [...wardrobeItems, ...marketplaceProducts];
  const fromPool = withMarketplaceFlags(generateCandidates(pool, context, profile, config)).filter(
    (outfit) => outfit.marketplace_ids.length > 0 && outfit.marketplace_ids.length <= maxPerOutfit,
  );

  const mixed = [];
  const seen = new Set(wardrobeOnly.map((outfit) => outfit.outfitId));
  const push = (outfit) => {
    if (!outfit || seen.has(outfit.outfitId) || mixed.length >= maxMixed) return;
    const ids = marketplaceIdsOf(outfit);
    if (!ids.length || ids.length > maxPerOutfit) return;
    seen.add(outfit.outfitId);
    mixed.push(cloneOutfitMeta(outfit, ids));
  };

  for (const outfit of fromPool) push(outfit);

  // Targeted substitutes / optional adds on top wardrobe bases.
  const bases = wardrobeOnly.slice(0, Math.min(40, wardrobeOnly.length));
  for (const product of marketplaceProducts) {
    for (const base of bases) {
      if (mixed.length >= maxMixed) break;
      push(substituteRole(base, product));
      push(addOptionalRole(base, product));
    }
  }

  // Incomplete wardrobe completion: generate from marketplace-filled missing roles only.
  if (!wardrobeOnly.length) {
    const completed = withMarketplaceFlags(generateCandidates(pool, context, profile, config));
    for (const outfit of completed) push(outfit);
  }

  mixed.sort((a, b) => a.outfitId.localeCompare(b.outfitId));
  const all = [...wardrobeOnly, ...mixed];
  // Prefer stable id order then let ranker sort by score.
  all.sort((a, b) => a.outfitId.localeCompare(b.outfitId));
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
      price: item.price,
      currency: item.currency ?? "USD",
      brand: item.brand,
      sizes: item.sizes ?? [],
      colors: item.colors,
    }));
}
