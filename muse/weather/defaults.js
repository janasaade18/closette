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
  sweatshirt: { min_c: -2, max_c: 20 },
  hoodie: { min_c: -2, max_c: 20 },
  sweater: { min_c: -5, max_c: 18 },
  // Light jackets stay eligible through cool / rainy days around 18°C.
  jacket: { min_c: -5, max_c: 20 },
  blazer: { min_c: 4, max_c: 22 },
  coat: { min_c: -12, max_c: 14 },
  "trench-coat": { min_c: -8, max_c: 18 },
  raincoat: { min_c: 0, max_c: 22 },
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

/** Open shoes / summer pieces that should not go out in rain without a better option. */
const RAIN_UNSUITABLE = new Set(["sandals", "heels", "flats", "tank-top", "shorts", "romper"]);

/**
 * Fill missing temperature bounds only. Explicit garment metadata always wins.
 * Also fills rain/snow unsuitable_conditions when the closet left them empty.
 */
export function applyClimateDefaults(item) {
  let next = { ...item, climate_defaulted: false };
  if (item.temperatureMin == null && item.temperatureMax == null) {
    const defaults = climateDefaultFor(item);
    if (defaults) {
      next = {
        ...next,
        temperatureMin: defaults.min_c,
        temperatureMax: defaults.max_c,
        climate_defaulted: true,
        climate_default_source: defaults.source,
      };
    }
  }
  if ((!next.unsuitableConditions || next.unsuitableConditions.length === 0) && RAIN_UNSUITABLE.has(next.subcategory)) {
    next = {
      ...next,
      unsuitableConditions: ["rain", "snow"],
      climate_condition_defaulted: true,
    };
  }
  return next;
}

export function weatherAdvice(tempC, condition) {
  if (condition === "rain") {
    return "Rainy — prefer a jacket or raincoat, closed shoes, and skip open summer pieces.";
  }
  if (condition === "snow") {
    return "Snow — prefer a coat, closed shoes, and warm layers.";
  }
  if (typeof tempC !== "number") return null;
  if (tempC <= 8) {
    return "Not recommended for summer-only pieces — it is cold. Prefer layers, trousers, closed shoes, and a coat.";
  }
  if (tempC <= 18) {
    return "Cool weather — a jacket or long sleeves beat a short-sleeve tee alone.";
  }
  if (tempC >= 28) {
    return "Not recommended for heavy coats — it is hot. Prefer breathable tops, shorts or light trousers.";
  }
  if (tempC >= 22) {
    return "Warm weather — lighter fabrics fit better than winter outerwear.";
  }
  return null;
}
