import { defaultConfig } from "./config.js";
import { normalizeGarment } from "./schemas/garment.js";
import { validateRecommendRequest } from "./schemas/validate.js";
import { API_VERSION, MODEL_VERSION, normToken } from "./schemas/constants.js";
import { partitionItems, outfitViolations } from "./compatibility_rules/rules.js";
import { generateCandidates } from "./candidate_generation/generate.js";
import { rankOutfits, selectDiverse } from "./ranking/rank.js";
import { defaultLearnedWeightsPath, loadLearnedModel } from "./ranking/learned.js";
import { fitUserLinUCB } from "./personalization/fit.js";
import { recommendationIdFor } from "./ids.js";
import { SCORE_NOTE, SCORE_SEMANTICS, apiError } from "./util.js";

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
  };
}

function publicOutfit(outfit, modelVersion) {
  return {
    outfit_id: outfit.outfitId,
    items: [...outfit.itemIds],
    roles: { ...outfit.roles },
    score: outfit.score,
    reasons: [...outfit.reasons],
    reason_codes: [...outfit.reason_codes],
    signals_used: [...outfit.signals_used],
    model_version: modelVersion,
  };
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

  const normalized = resolved.items.map((raw) => normalizeGarment(raw));
  const { eligible, excluded } = partitionItems(normalized, value.context, profile, config);
  const generated = generateCandidates(eligible, value.context, profile, config);
  const candidates = generated.filter((outfit) => outfitViolations(outfit).length === 0);
  const ranked = rankOutfits(candidates, value.context, profile, history, config, learnedModel, userModel);
  const selected = selectDiverse(ranked, value.limit, config);
  rankingMeta.feedback_applied = selected.some((outfit) => outfit.feedback_applied);
  rankingMeta.personalization_applied = selected.some((outfit) => outfit.personalization_applied);

  const shownIds = selected.map((outfit) => outfit.outfitId);
  const recommendationId = recommendationIdFor(value.userId, value.context, shownIds);
  const status = selected.length ? "ok" : "insufficient_candidates";
  const body = {
    recommendation_id: recommendationId,
    recommendations: selected.map((outfit) => publicOutfit(outfit, effectiveModelVersion)),
    ranking: rankingMeta,
    warnings,
    excluded_items: excluded,
    message: selected.length
      ? "Recommendations use only garments from the supplied wardrobe."
      : "Garments were found, and none formed an outfit that passed the rules.",
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
      shown: selected.map(snapshot),
      eligible_not_shown: ranked.filter((outfit) => !shown.has(outfit.outfitId)).map(snapshot),
    });
  }

  return envelope(status, body, effectiveModelVersion, scoreMeta);
}
