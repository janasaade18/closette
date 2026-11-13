/**
 * Phase 4 travel packing: multi-day plans with day weather, outfit rotation,
 * luggage optimization, and optional marketplace complements.
 * Reuses recommend() (MLP + LinUCB + marketplace retrieval) per day.
 */
import { defaultConfig } from "../config.js";
import { recommend } from "../pipeline.js";
import { API_VERSION } from "../schemas/constants.js";
import { optimizeLuggage } from "./luggage.js";
import { selectRotatingOutfits } from "./rotation.js";
import { validateTravelPackRequest } from "./validate.js";

function dayRecommendBody(value, day, limit) {
  const body = {
    user_id: value.userId,
    occasion: day.occasion,
    season: day.season,
    weather: day.weather,
    limit,
    profile: value.profile,
    preferences_override: value.preferencesOverride,
  };
  if (value.personalization) body.personalization = value.personalization;
  if (value.wardrobe) body.wardrobe = value.wardrobe;
  if (value.wardrobeItemIds) body.wardrobe_item_ids = value.wardrobeItemIds;
  if (value.marketplace) body.marketplace = value.marketplace;
  if (value.marketplaceProducts) body.marketplace_products = value.marketplaceProducts;
  return body;
}

function wardrobeIndex(value, deps) {
  const map = new Map();
  const rows = [];
  if (Array.isArray(value.wardrobe)) rows.push(...value.wardrobe);
  if (deps.catalog && value.wardrobeItemIds) {
    const stored = deps.catalog.getWardrobe(value.userId) ?? [];
    rows.push(...stored);
  }
  if (Array.isArray(value.marketplaceProducts)) rows.push(...value.marketplaceProducts);
  if (deps.marketplaceCatalog) rows.push(...deps.marketplaceCatalog.list());
  for (const row of rows) {
    if (row?.id != null) map.set(String(row.id).trim(), row);
  }
  return map;
}

export function planTravel(request, deps = {}) {
  const config = deps.config ?? defaultConfig();
  const parsed = validateTravelPackRequest(request, config);
  if (parsed.error) return parsed.error;
  const value = parsed.value;

  const dayCandidates = [];
  const perDayMeta = [];
  for (const day of value.trip.days) {
    const result = recommend(dayRecommendBody(value, day, value.candidatesPerDay), deps);
    if (result.statusCode !== 200) {
      return result;
    }
    dayCandidates.push({
      date: day.date,
      label: day.label,
      occasion: day.occasion,
      weather: day.weather,
      season: day.season,
      candidates: result.body.recommendations ?? [],
    });
    perDayMeta.push({
      date: day.date,
      model_version: result.body.model_version,
      ranking: result.body.ranking,
      status: result.body.status,
    });
  }

  let dayPlans = selectRotatingOutfits(dayCandidates, value.luggage);
  const byId = wardrobeIndex(value, deps);
  // Attach marketplace flags onto indexed marketplace products from responses.
  for (const day of dayPlans) {
    for (const item of day.outfit?.marketplace_items ?? []) {
      byId.set(item.product_id, {
        id: item.product_id,
        category: item.category,
        source: "marketplace",
        price: item.price,
        weight_kg: null,
      });
    }
  }

  const optimized = optimizeLuggage(dayPlans, byId, value.luggage);
  dayPlans = optimized.dayPlans;
  const inventory = optimized.inventory;

  const covered = dayPlans.filter((day) => day.status === "ok" && day.outfit).length;
  const status =
    covered === 0 ? "insufficient_candidates" : covered < dayPlans.length ? "partial" : "ok";

  const marketplaceSuggestions = [
    ...new Map(
      dayPlans
        .flatMap((day) => day.outfit?.marketplace_items ?? [])
        .map((item) => [item.product_id, item]),
    ).values(),
  ];

  return {
    statusCode: 200,
    body: {
      api_version: API_VERSION,
      model_version: "muse-travel-v1",
      status,
      score_semantics: "multi_day_mlp_linucb_marketplace_packing",
      score_note:
        "Each day is ranked with Muse's MLP (+ LinUCB when warm). Travel adds rotation and luggage optimization across days.",
      destination: value.destination,
      trip: {
        start_date: value.trip.startDate,
        days: value.trip.days.length,
      },
      luggage: {
        max_items: value.luggage.maxItems,
        max_weight_kg: value.luggage.maxWeightKg,
        prefer_rewear: value.luggage.preferRewear,
        max_core_reuses: value.luggage.maxCoreReuses,
        ...inventory,
      },
      day_plans: dayPlans,
      packing_list: inventory.items,
      marketplace_suggestions: marketplaceSuggestions,
      per_day_ranking: perDayMeta,
      warnings: optimized.warnings,
      message:
        status === "ok"
          ? "Packed a multi-day plan with outfit rotation and luggage constraints."
          : status === "partial"
            ? "Packed some days; others lacked legal outfit candidates."
            : "No day produced a legal outfit from the wardrobe/marketplace pool.",
    },
  };
}
