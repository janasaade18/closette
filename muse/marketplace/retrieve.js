/**
 * Structured complement retrieval over a marketplace catalog.
 * Not RAG and not an LLM: deterministic slot/color/formality/price scoring.
 */
import { COLOR_FAMILIES, NEUTRAL_COLORS } from "../schemas/constants.js";
import { formalityAffinity } from "../ranking/affinity.js";
import { clamp01, round4 } from "../util.js";

function pairHarmony(left, right) {
  if (left === right) return 0.85;
  if (NEUTRAL_COLORS.has(left) || NEUTRAL_COLORS.has(right)) return 0.9;
  if (left === "multicolor" || right === "multicolor") return 0.6;
  const leftFamily = COLOR_FAMILIES[left];
  const rightFamily = COLOR_FAMILIES[right];
  if (leftFamily && leftFamily === rightFamily) return 0.8;
  return 0.55;
}

function wardrobeColors(items) {
  return items.map((item) => item.colors?.primary).filter(Boolean);
}

function wardrobeRoles(items) {
  const counts = {};
  for (const item of items) {
    if (!item.role) continue;
    counts[item.role] = (counts[item.role] ?? 0) + 1;
  }
  return counts;
}

function priceFit(price, budgetMax) {
  if (price == null) return 0.55;
  if (budgetMax == null || !(budgetMax > 0)) return 0.6;
  if (price > budgetMax) return 0;
  const ratio = price / budgetMax;
  if (ratio <= 0.35) return 0.7;
  if (ratio <= 0.7) return 0.95;
  return 0.8;
}

function slotNeed(product, roleCounts) {
  if (!product.role) return 0.35;
  if (product.role === "outerwear" || product.role === "accessory") {
    return roleCounts[product.role] ? 0.55 : 0.95;
  }
  // Completing or refreshing a core slot.
  if (!roleCounts[product.role]) return 1;
  return 0.65;
}

function colorFit(product, colors) {
  const primary = product.colors?.primary;
  if (!primary || !colors.length) return 0.55;
  const scores = colors.map((color) => pairHarmony(primary, color));
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function occasionFit(product, context) {
  if (!context?.occasion) return 0.55;
  const affinity = formalityAffinity(context.occasion, product.formality);
  return affinity == null ? 0.55 : affinity;
}

function wardrobeFormalityBias(items) {
  const ranks = { athletic: 0, casual: 1, "smart-casual": 2, work: 3, formal: 4 };
  const values = items.map((item) => ranks[item.formality]).filter((value) => value != null);
  if (!values.length) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formalityCohesion(product, wardrobeItems) {
  const bias = wardrobeFormalityBias(wardrobeItems);
  const ranks = { athletic: 0, casual: 1, "smart-casual": 2, work: 3, formal: 4 };
  const productRank = ranks[product.formality];
  if (productRank == null) return 0.7;
  const gap = Math.abs(productRank - bias);
  if (gap <= 1) return 1;
  if (gap <= 1.5) return 0.55;
  return 0.15;
}

function weatherLayerBoost(product, context) {
  const condition = context?.weather?.condition;
  const temp = context?.weather?.temperature_c;
  const cool =
    condition === "rain" ||
    condition === "snow" ||
    condition === "cold" ||
    (typeof temp === "number" && temp <= 18);
  if (!cool || product.role !== "outerwear") return 0.55;
  if (product.subcategory === "raincoat" || product.subcategory === "jacket") return 1;
  if (product.subcategory === "coat" || product.subcategory === "trench-coat") return 0.75;
  if (product.subcategory === "blazer" && condition === "rain") return 0.25;
  return 0.55;
}

export function complementScore(product, wardrobeItems, context, constraints = {}) {
  const roles = wardrobeRoles(wardrobeItems);
  const colors = wardrobeColors(wardrobeItems);
  const slot = slotNeed(product, roles);
  const color = colorFit(product, colors);
  const occasion = occasionFit(product, context);
  const price = priceFit(product.price, constraints.budgetMax);
  const weather =
    typeof context?.weather?.temperature_c === "number" &&
    product.temperatureMin != null &&
    product.temperatureMax != null &&
    context.weather.temperature_c >= product.temperatureMin &&
    context.weather.temperature_c <= product.temperatureMax
      ? 1
      : 0.55;
  const cohesion = formalityCohesion(product, wardrobeItems);
  const layer = weatherLayerBoost(product, context);
  const raw =
    0.22 * slot +
    0.18 * color +
    0.16 * occasion +
    0.14 * cohesion +
    0.12 * layer +
    0.1 * price +
    0.08 * weather;
  return {
    score: round4(clamp01(raw)),
    parts: { slot, color, occasion, cohesion, layer, price, weather },
  };
}

export function retrieveComplements(products, wardrobeItems, context, constraints, limit = 24) {
  const ranked = products
    .map((product) => {
      const scored = complementScore(product, wardrobeItems, context, constraints);
      return { product, ...scored };
    })
    .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));
  return ranked.slice(0, Math.max(0, limit));
}
