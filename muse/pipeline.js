import { defaultConfig } from "./config.js";
import { normalizeGarment } from "./schemas/garment.js";
import { validateRecommendRequest } from "./schemas/validate.js";
import { API_VERSION, MODEL_VERSION, normToken } from "./schemas/constants.js";
import { partitionItems, outfitViolations } from "./compatibility_rules/rules.js";
import { generateCandidates } from "./candidate_generation/generate.js";
import { rankOutfits, selectDiverse } from "./ranking/rank.js";
import { defaultLearnedWeightsPath, loadLearnedModel } from "./ranking/learned.js";
import { fitUserLinUCB } from "./personalization/fit.js";
import {
  defaultMarketplaceFixturePath,
  loadMarketplaceCatalog,
  MemoryMarketplaceCatalog,
} from "./marketplace/catalog.js";
import { filterMarketplaceProducts } from "./marketplace/constraints.js";
import { generateMixedCandidates, publicMarketplaceItems, summarizeMarketplaceUsage } from "./marketplace/mix.js";
import { retrieveComplements } from "./marketplace/retrieve.js";
import { applyClimateDefaults, weatherAdvice } from "./weather/defaults.js";
import { recommendationIdFor } from "./ids.js";
import { SCORE_NOTE, SCORE_SEMANTICS, apiError } from "./util.js";
import { RULE } from "./compatibility_rules/rules.js";

export { MemoryMarketplaceCatalog };

export class MemoryCatalog {
  constructor(byUser) {
    this.byUser = byUser ?? {};
  }

  getWardrobe(userId) {
    if (!Object.prototype.hasOwnProperty.call(this.byUser, userId)) return null;
    return this.byUser[userId];
  }
}

function list(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normToken(entry)).filter(Boolean);
}

function idList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

export function buildProfile(input) {
  const base = input.profile ?? {};
  const over = input.preferencesOverride ?? {};
  const pick = (key) => (over[key] != null ? over[key] : base[key]);
  const profile = {
    preferredStyles: list(pick("preferred_styles")),
    favoriteColors: list(pick("favorite_colors")),
    dislikedColors: list(pick("disliked_colors")),
    preferredGarmentTypes: list(pick("preferred_garment_types")),
    explicitPreferences: (pick("explicit_preferences") ?? []).filter((entry) => typeof entry === "string"),
    avoidGarmentIds: idList(pick("avoid_garment_ids")),
    avoidSubcategories: list(pick("avoid_subcategories")),
    avoidCategories: list(pick("avoid_categories")),
  };
  const conflicts = profile.favoriteColors.filter((color) => profile.dislikedColors.includes(color));
  if (conflicts.length) {
    profile.favoriteColors = profile.favoriteColors.filter((color) => !conflicts.includes(color));
  }
  return { profile, conflicts };
}

function snapshot(outfit) {
  return {
    outfit_id: outfit.outfitId,
    garment_ids: [...outfit.itemIds],
    score: outfit.score,
    features: outfit.features,
    reasons: [...outfit.reasons],
    marketplace_ids: [...(outfit.marketplace_ids ?? [])],
    mixed: Boolean(outfit.mixed),
  };
}

function publicOutfit(outfit, modelVersion) {
  const marketplaceItems = publicMarketplaceItems(outfit);
  return {
    outfit_id: outfit.outfitId,
    items: [...outfit.itemIds],
    roles: { ...outfit.roles },
    score: outfit.score,
    reasons: [...outfit.reasons],
    reason_codes: [...outfit.reason_codes],
    signals_used: [...outfit.signals_used],
    model_version: modelVersion,
    mixed: Boolean(outfit.mixed || marketplaceItems.length),
    marketplace_items: marketplaceItems,
  };
}

function resolveMarketplaceCatalog(value, deps, config) {
  if (Array.isArray(value.marketplaceProducts)) {
    return new MemoryMarketplaceCatalog(value.marketplaceProducts);
  }
  if (deps.marketplaceCatalog) return deps.marketplaceCatalog;
  if (!config.marketplaceEnabled && !(value.marketplace?.enabled)) return null;
  const path = config.marketplaceCatalogPath ?? defaultMarketplaceFixturePath();
  try {
    return loadMarketplaceCatalog(path);
  } catch {
    return null;
  }
}

function envelope(status, extra, modelVersion = MODEL_VERSION, scoreMeta = null) {
  return {
    statusCode: 200,
    body: {
      api_version: API_VERSION,
      model_version: modelVersion,
      status,
      score_semantics: scoreMeta?.semantics ?? SCORE_SEMANTICS,
      score_note: scoreMeta?.note ?? SCORE_NOTE,
      ...extra,
    },
  };
}

const LEARNED_SCORE_META = {
  semantics: "mlp_preference_score_in_0_1",
  note: "Scores run from 0 to 1. With ranking_policy=learned they come from Closette's Muse MLP ranker over the shared feature vector. Candidate generation and hard rules are unchanged.",
};

function resolveRawItems(value, catalog) {
  if (Array.isArray(value.wardrobe)) {
    const ids = value.wardrobeItemIds ? new Set(value.wardrobeItemIds) : null;
    const unknown = [];
    const items = [];
    const available = new Set(value.wardrobe.map((item) => String(item.id).trim()));
    if (ids) {
      for (const id of ids) {
        if (!available.has(id)) unknown.push(id);
      }
    }
    for (const raw of value.wardrobe) {
      const id = String(raw.id).trim();
      if (ids && !ids.has(id)) continue;
      items.push(raw);
    }
    return { items, unknown, catalogMiss: false };
  }
  if (!catalog) {
    return {
      error: apiError(
        422,
        "wardrobe_unavailable",
        "wardrobe_item_ids were sent without garment records. Include a wardrobe array or configure a wardrobe catalog.",
      ),
    };
  }
  const stored = catalog.getWardrobe(value.userId);
  if (stored == null) {
    return { items: [], unknown: [...value.wardrobeItemIds], catalogMiss: true };
  }
  const byId = new Map(stored.map((item) => [String(item.id).trim(), item]));
  const unknown = [];
  const items = [];
  for (const id of value.wardrobeItemIds) {
    const found = byId.get(id);
    if (!found) unknown.push(id);
    else items.push(found);
  }
  return { items, unknown, catalogMiss: false };
}

export function recommend(request, deps = {}) {
  let config = deps.config ?? defaultConfig();
  if (config.personalization !== "baseline" && config.personalization !== "linucb") {
    return apiError(
      400,
      "personalization_not_available",
      `Unsupported personalization mode: ${config.personalization}`,
    );
  }

  const parsed = validateRecommendRequest(request, config);
  if (parsed.error) return parsed.error;
  const value = parsed.value;
  if (value.personalization) {
    config = { ...config, personalization: value.personalization };
  }
  const resolved = resolveRawItems(value, deps.catalog);
  if (resolved.error) return resolved.error;

  const warnings = [];
  if (value.unknownFields.length) {
    warnings.push({
      code: "unknown_fields",
      fields: value.unknownFields,
      message: "Unrecognized request fields were ignored.",
    });
  }
  if (resolved.unknown.length) {
    warnings.push({
      code: "unknown_wardrobe_items",
      item_ids: resolved.unknown,
      message: "Some wardrobe ids were not found and were left out.",
    });
  }
  if (resolved.catalogMiss) {
    warnings.push({
      code: "unknown_user_wardrobe",
      message: "No wardrobe is stored for this user.",
    });
  }

  const { profile, conflicts } = buildProfile(value);
  if (conflicts.length) {
    warnings.push({
      code: "conflicting_color_preference",
      colors: conflicts,
      message: "A color was both liked and disliked. The dislike was applied.",
    });
  }
  if (profile.explicitPreferences.length) {
    warnings.push({
      code: "explicit_preferences_not_interpreted",
      preferences: profile.explicitPreferences,
      message: "Free-text preferences are stored on the request and are not turned into rules.",
    });
  }

  const history = deps.store ? deps.store.eventsForUser(value.userId) : [];
  let learnedModel = deps.learnedModel ?? null;
  if (!learnedModel && config.rankingPolicy === "learned") {
    try {
      learnedModel = loadLearnedModel(config.learnedModelPath ?? defaultLearnedWeightsPath());
    } catch {
      learnedModel = null;
    }
  }
  const useLearned = Boolean(learnedModel && config.rankingPolicy === "learned");
  const userModel =
    config.personalization === "linucb"
      ? deps.userModel ?? fitUserLinUCB(history, deps.store, config)
      : { model: null, updates: 0, ready: false };
  const usePersonalization = Boolean(userModel.ready);
  const effectiveModelVersion = useLearned
    ? usePersonalization
      ? "muse-ranker-v1+linucb"
      : learnedModel.model_version ?? "muse-ranker-v1"
    : usePersonalization
      ? `${config.modelVersion}+linucb`
      : config.modelVersion;
  const marketplaceOpts = value.marketplace;
  const marketplaceOn =
    marketplaceOpts?.enabled === true ||
    (marketplaceOpts == null && config.marketplaceEnabled) ||
    Array.isArray(value.marketplaceProducts);
  const rankingMeta = {
    method: useLearned
      ? usePersonalization
        ? "learned_mlp_plus_linucb"
        : "learned_mlp_ranker"
      : usePersonalization
        ? "baseline_plus_linucb"
        : "baseline_weighted_features",
    learned_model: useLearned,
    personalization: config.personalization,
    personalization_applied: usePersonalization,
    linucb_updates: userModel.updates,
    feedback_events: history.length,
    feedback_min_events: config.feedbackMinEvents,
    feedback_applied: false,
    marketplace_enabled: Boolean(marketplaceOn),
    marketplace_products_considered: 0,
    marketplace_products_used: 0,
    marketplace_mixed_outfits: 0,
    marketplace_rejected: 0,
  };

  const scoreMeta = useLearned ? LEARNED_SCORE_META : null;

  if (resolved.items.length === 0) {
    const recommendationId = recommendationIdFor(value.userId, value.context, []);
    return envelope("empty_wardrobe", {
      recommendation_id: recommendationId,
      recommendations: [],
      ranking: rankingMeta,
      warnings,
      excluded_items: [],
      message: "The wardrobe has no garments to recommend from.",
    }, effectiveModelVersion, scoreMeta);
  }

  const normalized = resolved.items
    .map((raw) => normalizeGarment(raw))
    .map((item) => applyClimateDefaults(item));
  const { eligible, excluded } = partitionItems(normalized, value.context, profile, config);
  const tempC = value.context.weather?.temperature_c;
  const weatherExcluded = excluded.filter((row) => row.rules.includes(RULE.temperatureRange));
  const advice = weatherAdvice(tempC);
  if (weatherExcluded.length) {
    warnings.push({
      code: "weather_excluded_items",
      message:
        advice ??
        "Some garments were left out because they do not fit the requested temperature.",
      item_ids: weatherExcluded.map((row) => row.item_id),
      temperature_c: typeof tempC === "number" ? tempC : null,
    });
  }

  let generated;
  let marketplaceRejected = [];
  if (marketplaceOn) {
    const catalog = resolveMarketplaceCatalog(value, deps, config);
    const rawProducts = catalog ? catalog.list() : [];
    const constraints = {
      budgetMax: marketplaceOpts?.budgetMax ?? null,
      budgetMin: marketplaceOpts?.budgetMin ?? null,
      sizes: marketplaceOpts?.sizes ?? [],
      categories: marketplaceOpts?.categories ?? [],
      requireInStock: true,
    };
    const filtered = filterMarketplaceProducts(rawProducts, constraints, value.context, config);
    marketplaceRejected = filtered.rejected;
    const limit = marketplaceOpts?.maxProducts ?? config.marketplaceMaxProducts ?? 24;
    const retrieved = retrieveComplements(filtered.accepted, eligible, value.context, constraints, limit);
    const products = retrieved.map((row) => row.product);
    rankingMeta.marketplace_products_considered = products.length;
    rankingMeta.marketplace_rejected = marketplaceRejected.length;

    const includeMixed = marketplaceOpts?.includeMixed !== false;
    if (includeMixed && products.length) {
      const mixConfig = {
        ...config,
        marketplaceEnabled: true,
        marketplaceMaxItemsPerOutfit: config.marketplaceMaxItemsPerOutfit,
        marketplaceMaxMixedCandidates: config.marketplaceMaxMixedCandidates,
      };
      generated = generateMixedCandidates(eligible, products, value.context, profile, mixConfig).all;
    } else {
      generated = generateMixedCandidates(eligible, [], value.context, profile, config).wardrobeOnly;
    }

    if (!catalog && !value.marketplaceProducts) {
      warnings.push({
        code: "marketplace_catalog_unavailable",
        message: "Marketplace mode was requested and no catalog was available.",
      });
    }
  } else {
    generated = generateCandidates(eligible, value.context, profile, config).map((outfit) => ({
      ...outfit,
      mixed: false,
      marketplace_ids: [],
    }));
  }

  const candidates = generated.filter((outfit) => outfitViolations(outfit).length === 0);
  const ranked = rankOutfits(candidates, value.context, profile, history, config, learnedModel, userModel);
  const selected = selectDiverse(ranked, value.limit, config);
  rankingMeta.feedback_applied = selected.some((outfit) => outfit.feedback_applied);
  rankingMeta.personalization_applied = selected.some((outfit) => outfit.personalization_applied);
  const usage = summarizeMarketplaceUsage(selected);
  rankingMeta.marketplace_products_used = usage.product_ids.length;
  rankingMeta.marketplace_mixed_outfits = usage.mixed_outfits;
  if (usage.product_ids.length && useLearned) {
    rankingMeta.method = usePersonalization
      ? "learned_mlp_plus_linucb_marketplace"
      : "learned_mlp_marketplace";
  }

  const shownIds = selected.map((outfit) => outfit.outfitId);
  const recommendationId = recommendationIdFor(value.userId, value.context, shownIds);
  const weatherBlocked =
    !selected.length &&
    typeof tempC === "number" &&
    weatherExcluded.length > 0 &&
    weatherExcluded.length >= Math.max(1, Math.ceil(excluded.length * 0.5));
  let status = selected.length ? "ok" : weatherBlocked ? "weather_unsuitable" : "insufficient_candidates";
  const mixedSelected = usage.mixed_outfits > 0;
  const cold = typeof tempC === "number" && tempC < (config.coldTempC ?? 18);
  const hot = typeof tempC === "number" && tempC >= 26;
  let message;
  if (selected.length) {
    const weakWeather = selected.filter(
      (outfit) => outfit.features?.weather_suitability != null && outfit.features.weather_suitability < 0.45,
    );
    if (weakWeather.length === selected.length && (cold || hot)) {
      status = "weather_compromise";
      message = cold
        ? `These are the best options from your closet, but they are light for ${tempC}°C. A coat or warmer layers would be better.`
        : `These are the best options from your closet, but they look heavy for ${tempC}°C. Lighter pieces would be better.`;
      warnings.push({
        code: "weather_compromise",
        message,
        temperature_c: tempC,
      });
    } else {
      message = mixedSelected
        ? "Recommendations may mix wardrobe pieces with marketplace products that passed constraints."
        : "Recommendations use garments from the supplied wardrobe.";
    }
  } else if (weatherBlocked) {
    message = cold
      ? `Nothing in this wardrobe is suitable for ${tempC}°C. Summer pieces like tees and shorts were left out — add trousers, closed shoes, or a coat.`
      : hot
        ? `Nothing in this wardrobe is suitable for ${tempC}°C. Heavy coats or winter layers were left out — add lighter tops and breathable pieces.`
        : `Nothing in this wardrobe fits the requested temperature (${tempC}°C).`;
  } else {
    message = "Garments were found, and none formed an outfit that passed the rules.";
  }

  const body = {
    recommendation_id: recommendationId,
    recommendations: selected.map((outfit) => publicOutfit(outfit, effectiveModelVersion)),
    ranking: rankingMeta,
    warnings,
    excluded_items: excluded,
    marketplace_excluded: marketplaceRejected.slice(0, 20),
    weather: {
      temperature_c: typeof tempC === "number" ? tempC : null,
      advice,
      excluded_for_temperature: weatherExcluded.length,
    },
    message,
  };

  if (deps.store && selected.length) {
    const shown = new Set(shownIds);
    deps.store.saveRecommendation({
      recommendation_id: recommendationId,
      user_id: value.userId,
      context: value.context,
      model_version: effectiveModelVersion,
      ranking_method: rankingMeta.method,
      learned_model: useLearned,
      marketplace_product_ids: usage.product_ids,
      shown: selected.map(snapshot),
      eligible_not_shown: ranked.filter((outfit) => !shown.has(outfit.outfitId)).map(snapshot),
    });
  }

  return envelope(status, body, effectiveModelVersion, scoreMeta);
}
