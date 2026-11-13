/**
 * When closet garments lack temperature_range_c (common from the mobile app),
 * Muse fills sensible defaults from subcategory so cold/hot requests can exclude
 * clearly unsuitable pieces and explain why.
 */

const BY_SUBCATEGORY = {
  // Hard summer-only pieces — blocked outdoors when cold.
  "tank-top": { min_c: 18, max_c: 40 },
  shorts: { min_c: 18, max_c: 40 },
  sandals: { min_c: 18, max_c: 42 },
  romper: { min_c: 16, max_c: 38 },
  skirt: { min_c: 14, max_c: 34 },
  // Base-layer tops can sit under a coat on cold days.
  "t-shirt": { min_c: 4, max_c: 36 },
  blouse: { min_c: 6, max_c: 30 },
  polo: { min_c: 6, max_c: 32 },
  shirt: { min_c: 2, max_c: 30 },
  dress: { min_c: 10, max_c: 32 },
  chinos: { min_c: 6, max_c: 30 },
  jeans: { min_c: 0, max_c: 30 },
  trousers: { min_c: 0, max_c: 28 },
  sneakers: { min_c: 0, max_c: 34 },
  flats: { min_c: 6, max_c: 32 },
  leggings: { min_c: 0, max_c: 26 },
  sweatshirt: { min_c: -2, max_c: 18 },
  hoodie: { min_c: -2, max_c: 18 },
  sweater: { min_c: -5, max_c: 16 },
  jacket: { min_c: -5, max_c: 16 },
  blazer: { min_c: 4, max_c: 22 },
  coat: { min_c: -12, max_c: 14 },
  "trench-coat": { min_c: -8, max_c: 14 },
  raincoat: { min_c: 0, max_c: 18 },
  boots: { min_c: -12, max_c: 16 },
  "formal-shoes": { min_c: -2, max_c: 28 },
  heels: { min_c: 4, max_c: 30 },
  scarf: { min_c: -12, max_c: 14 },
  gloves: { min_c: -18, max_c: 10 },
  hat: { min_c: -8, max_c: 36 },
};

const BY_CATEGORY = {
  tops: { min_c: 8, max_c: 32 },
  bottoms: { min_c: 6, max_c: 30 },
  "one-piece": { min_c: 12, max_c: 32 },
  outerwear: { min_c: -8, max_c: 16 },
  footwear: { min_c: 2, max_c: 34 },
  accessories: { min_c: -10, max_c: 36 },
};

export function climateDefaultFor(item) {
  if (item?.subcategory && BY_SUBCATEGORY[item.subcategory]) {
    return { ...BY_SUBCATEGORY[item.subcategory], source: "subcategory_default" };
  }
  if (item?.category && BY_CATEGORY[item.category]) {
    return { ...BY_CATEGORY[item.category], source: "category_default" };
  }
  return null;
}

/**
 * Fill missing temperature bounds only. Explicit garment metadata always wins.
 */
export function applyClimateDefaults(item) {
  if (item.temperatureMin != null || item.temperatureMax != null) {
    return { ...item, climate_defaulted: false };
  }
  const defaults = climateDefaultFor(item);
  if (!defaults) return { ...item, climate_defaulted: false };
  return {
    ...item,
    temperatureMin: defaults.min_c,
    temperatureMax: defaults.max_c,
    climate_defaulted: true,
    climate_default_source: defaults.source,
  };
}

export function weatherAdvice(tempC) {
  if (typeof tempC !== "number") return null;
  if (tempC <= 8) {
    return "Not recommended for summer-only pieces — it is cold. Prefer layers, trousers, closed shoes, and a coat.";
  }
  if (tempC <= 14) {
    return "Cool weather — light layers or a jacket beat tees and shorts alone.";
  }
  if (tempC >= 28) {
    return "Not recommended for heavy coats — it is hot. Prefer breathable tops, shorts or light trousers.";
  }
  if (tempC >= 22) {
    return "Warm weather — lighter fabrics fit better than winter outerwear.";
  }
  return null;
}
