/**
 * Hard filters for marketplace products: budget, size, availability, weather, gender.
 */
import { suggestsCoolLayer } from "../candidate_generation/layers.js";

function normalizeGender(value) {
  if (!value || typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (["male", "man", "men", "masculine", "m"].includes(raw)) return "male";
  if (["female", "woman", "women", "feminine", "f"].includes(raw)) return "female";
  if (["unisex", "all", "any", "nonbinary", "non-binary", "nb"].includes(raw)) return "unisex";
  return raw;
}

export function productPassesConstraints(product, constraints, context, config) {
  if (!product) return { ok: false, reason: "missing_product" };
  if (constraints.requireInStock !== false && product.inStock === false) {
    return { ok: false, reason: "out_of_stock" };
  }
  const userGender = normalizeGender(constraints.gender ?? constraints.profileGender);
  const productGender = normalizeGender(product.gender) ?? "unisex";
  if (userGender && userGender !== "unisex" && productGender !== "unisex" && productGender !== userGender) {
    return { ok: false, reason: "gender_mismatch" };
  }
  if (product.availability === "laundry" || product.availability === "unavailable") {
    return { ok: false, reason: "unavailable" };
  }
  if (constraints.budgetMax != null && product.price != null && product.price > constraints.budgetMax) {
    return { ok: false, reason: "over_budget" };
  }
  if (constraints.budgetMin != null && product.price != null && product.price < constraints.budgetMin) {
    return { ok: false, reason: "under_budget" };
  }
  if (constraints.sizes?.length && product.sizes?.length) {
    const wanted = new Set(constraints.sizes.map((size) => String(size).toUpperCase()));
    const hit = product.sizes.some((size) => wanted.has(String(size).toUpperCase()));
    if (!hit) return { ok: false, reason: "size_mismatch" };
  }
  if (constraints.categories?.length && product.category) {
    if (!constraints.categories.includes(product.category)) {
      return { ok: false, reason: "category_filtered" };
    }
  }

  const temp = context?.weather?.temperature_c;
  if (typeof temp === "number") {
    if (product.temperatureMin != null && temp < product.temperatureMin) {
      return { ok: false, reason: "too_cold_for_product" };
    }
    if (product.temperatureMax != null && temp > product.temperatureMax) {
      return { ok: false, reason: "too_warm_for_product" };
    }
  }
  if (context?.season && product.seasonsKnown && product.seasons.length) {
    if (!product.seasons.includes(context.season)) {
      // Soft for seasons: only drop when weather is absent and season clearly mismatches.
      if (typeof temp !== "number") return { ok: false, reason: "season_mismatch" };
    }
  }
  // Heavy coats on hot days even without an explicit temp range.
  if (typeof temp === "number" && temp >= (config?.coldTempC ?? 18) + 6) {
    if (product.subcategory === "coat" || product.subcategory === "trench-coat") {
      return { ok: false, reason: "weather_unsuitable" };
    }
  }
  if (suggestsCoolLayer(context, config) === false && product.role === "outerwear") {
    // Still allow tailored outerwear; retrieve scorer decides. Constraint stays permissive.
  }
  return { ok: true, reason: null };
}

export function filterMarketplaceProducts(products, constraints, context, config) {
  const accepted = [];
  const rejected = [];
  for (const product of products) {
    const verdict = productPassesConstraints(product, constraints, context, config);
    if (verdict.ok) accepted.push(product);
    else rejected.push({ id: product.id, reason: verdict.reason });
  }
  return { accepted, rejected };
}
