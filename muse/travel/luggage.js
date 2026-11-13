/**
 * Luggage optimization over selected day outfits.
 * Prefer garments that cover multiple days; respect max items / weight.
 */

const DEFAULT_WEIGHT_KG = {
  tops: 0.25,
  bottoms: 0.45,
  "one-piece": 0.4,
  outerwear: 1.1,
  footwear: 0.8,
  accessories: 0.15,
};

export function itemWeightKg(item) {
  if (typeof item.weight_kg === "number" && Number.isFinite(item.weight_kg)) return item.weight_kg;
  if (typeof item.weightKg === "number" && Number.isFinite(item.weightKg)) return item.weightKg;
  return DEFAULT_WEIGHT_KG[item.category] ?? 0.3;
}

export function packingInventory(dayPlans, wardrobeById) {
  const counts = new Map();
  for (const day of dayPlans) {
    for (const id of day.outfit?.items ?? []) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const items = [...counts.entries()]
    .map(([id, uses]) => {
      const garment = wardrobeById.get(id) ?? { id, category: null, source: "unknown" };
      return {
        id,
        uses,
        source: garment.source === "marketplace" ? "marketplace" : "wardrobe",
        category: garment.category ?? null,
        weight_kg: itemWeightKg(garment),
        price: garment.price ?? null,
      };
    })
    .sort((a, b) => b.uses - a.uses || a.id.localeCompare(b.id));

  const totalWeight = items.reduce((sum, row) => sum + row.weight_kg, 0);
  return {
    items,
    unique_items: items.length,
    total_weight_kg: Math.round(totalWeight * 1000) / 1000,
    wardrobe_items: items.filter((row) => row.source === "wardrobe").length,
    marketplace_items: items.filter((row) => row.source === "marketplace").length,
  };
}

/**
 * If packing exceeds max items/weight, drop lowest-utility marketplace extras first,
 * then lowest-use wardrobe accessories — without breaking day coverage when possible.
 */
export function optimizeLuggage(dayPlans, wardrobeById, luggage) {
  let inventory = packingInventory(dayPlans, wardrobeById);
  const warnings = [];
  const maxItems = luggage.maxItems ?? 16;
  const maxWeight = luggage.maxWeightKg;

  const overItems = () => inventory.unique_items > maxItems;
  const overWeight = () => maxWeight != null && inventory.total_weight_kg > maxWeight;

  if (!overItems() && !overWeight()) {
    return { inventory, dayPlans, warnings, optimized: false };
  }

  // Prefer keeping high-use core pieces; candidates to remove are single-use accessories/marketplace.
  const removable = inventory.items
    .filter((row) => row.uses === 1 && (row.source === "marketplace" || row.category === "accessories"))
    .sort((a, b) => a.weight_kg - b.weight_kg || a.id.localeCompare(b.id));

  const removed = new Set();
  for (const row of removable) {
    if (!overItems() && !overWeight()) break;
    removed.add(row.id);
    // Strip accessory/marketplace piece from the single day that used it.
    for (const day of dayPlans) {
      if (!day.outfit?.items?.includes(row.id)) continue;
      day.outfit = {
        ...day.outfit,
        items: day.outfit.items.filter((id) => id !== row.id),
        marketplace_items: (day.outfit.marketplace_items ?? []).filter((item) => item.product_id !== row.id),
        mixed: (day.outfit.marketplace_items ?? []).some((item) => item.product_id !== row.id),
        reasons: [
          "Luggage optimized: dropped a single-use add-on to fit the bag",
          ...(day.outfit.reasons ?? []).slice(0, 2),
        ],
      };
      if (!day.notes) day.notes = [];
      day.notes.push(`Removed ${row.id} for luggage fit`);
    }
    inventory = packingInventory(dayPlans, wardrobeById);
  }

  if (overItems() || overWeight()) {
    warnings.push({
      code: "luggage_over_capacity",
      message: "Could not fully satisfy luggage limits without dropping required day pieces.",
      unique_items: inventory.unique_items,
      total_weight_kg: inventory.total_weight_kg,
      max_items: maxItems,
      max_weight_kg: maxWeight,
    });
  } else if (removed.size) {
    warnings.push({
      code: "luggage_optimized",
      message: "Dropped single-use add-ons to fit luggage constraints.",
      removed_ids: [...removed],
    });
  }

  return { inventory, dayPlans, warnings, optimized: removed.size > 0 };
}
