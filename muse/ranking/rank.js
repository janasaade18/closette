import { COLOR_FAMILIES, NEUTRAL_COLORS, SPECIFIC_DISLIKE_REASONS } from "../schemas/constants.js";
import { formalityAffinity } from "./affinity.js";
import { layerContextActive, suggestsCoolLayer } from "../candidate_generation/layers.js";
import { marketplaceAffinity } from "../marketplace/affinity.js";
import { personalizeScore } from "../personalization/fit.js";
import { average, clamp01, round4 } from "../util.js";
import { buildLearnedVector, scoreLearnedVector } from "./learned.js";

export function pairHarmony(left, right) {
  if (left === right) return 0.85;
  if (NEUTRAL_COLORS.has(left) || NEUTRAL_COLORS.has(right)) return 0.9;
  if (left === "multicolor" || right === "multicolor") return 0.6;
  const leftFamily = COLOR_FAMILIES[left];
  const rightFamily = COLOR_FAMILIES[right];
  if (leftFamily && leftFamily === rightFamily) return 0.8;
  return 0.55;
}

function occasionMatch(outfit, context) {
  if (!context.occasion) return null;
  const scores = [];
  for (const item of outfit.items) {
    const parts = [];
    const affinity = formalityAffinity(context.occasion, item.formality);
    if (affinity != null) parts.push(affinity);
    if (item.styleTags.includes(context.occasion)) parts.push(1);
    if (parts.length) scores.push(average(parts));
  }
  return scores.length ? average(scores) : null;
}

function styleMatch(outfit, profile) {
  if (!profile.preferredStyles.length) return null;
  const scores = [];
  for (const item of outfit.items) {
    if (!item.styleTags.length) continue;
    const hit = item.styleTags.some((tag) => profile.preferredStyles.includes(tag));
    scores.push(hit ? 1 : 0.25);
  }
  return scores.length ? average(scores) : null;
}

function typeMatch(outfit, profile) {
  if (!profile.preferredGarmentTypes.length) return null;
  const known = outfit.items.filter((item) => item.subcategory || item.category);
  if (!known.length) return null;
  const hits = known.filter(
    (item) =>
      profile.preferredGarmentTypes.includes(item.subcategory) ||
      profile.preferredGarmentTypes.includes(item.category),
  );
  return hits.length / known.length;
}

function colorPreference(outfit, profile) {
  if (!profile.favoriteColors.length && !profile.dislikedColors.length) return null;
  const known = outfit.items.filter((item) => item.colors.primary);
  if (!known.length) return null;
  const scores = known.map((item) => {
    const primary = item.colors.primary;
    if (profile.dislikedColors.includes(primary)) return 0;
    if (profile.favoriteColors.includes(primary)) return 1;
    if (item.colors.secondary.some((color) => profile.dislikedColors.includes(color))) return 0.2;
    if (item.colors.secondary.some((color) => profile.favoriteColors.includes(color))) return 0.7;
    if (!profile.favoriteColors.length) return 0.6;
    return 0.45;
  });
  return average(scores);
}

function colorHarmony(outfit) {
  const colors = outfit.items.map((item) => item.colors.primary).filter(Boolean);
  if (colors.length < 2) return null;
  const pairs = [];
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) pairs.push(pairHarmony(colors[i], colors[j]));
  }
  return average(pairs);
}

function weatherSuitability(outfit, context) {
  const temp = context.weather?.temperature_c;
  const condition = context.weather?.condition ?? null;
  const season = context.season;
  if (typeof temp !== "number" && !condition && !season) return null;
  const scores = [];
  for (const item of outfit.items) {
    const parts = [];
    if (typeof temp === "number" && (item.temperatureMin != null || item.temperatureMax != null)) {
      const fits =
        (item.temperatureMin == null || temp >= item.temperatureMin) &&
        (item.temperatureMax == null || temp <= item.temperatureMax);
      parts.push(fits ? 1 : 0);
    }
    if (season && item.seasonsKnown && item.seasons.length) {
      parts.push(item.seasons.includes(season) ? 1 : 0);
    }
    if (condition && item.unsuitableConditions.length) {
      parts.push(item.unsuitableConditions.includes(condition) ? 0 : 1);
    }
    if (parts.length) scores.push(average(parts));
  }
  return scores.length ? average(scores) : null;
}

function contextLayer(outfit, context, config) {
  if (!layerContextActive(context, config)) return null;
  return outfit.roles.outerwear ? 1 : 0.35;
}

function feedbackSignal(outfit, events, config) {
  if (!events || events.length < config.feedbackMinEvents) {
    return { value: null, positive: false };
  }
  const ids = new Set(outfit.itemIds);
  let raw = 0;
  let evidence = false;
  let positive = 0;
  for (const event of events) {
    const matched = (event.garment_ids ?? []).filter((id) => ids.has(id));
    if (!matched.length || !event.garment_ids?.length) continue;
    const coverage = matched.length / event.garment_ids.length;
    evidence = true;
    const specific = event.reason && SPECIFIC_DISLIKE_REASONS.has(event.reason.code);
    let delta = -0.15;
    if (event.action === "like" || event.action === "save" || event.action === "purchase") {
      delta = event.action === "purchase" ? 1.6 : 1;
      positive += 1;
    } else if (event.action === "worn") {
      delta = 1.5;
      positive += 1;
    } else if (event.action === "dislike" && specific) {
      delta = -1;
    }
    raw += delta * coverage;
  }
  if (!evidence) return { value: null, positive: false };
  return { value: 1 / (1 + Math.exp(-raw)), positive: positive > 0 };
}

function contentFeatures(outfit, context, profile, config) {
  return {
    occasion_match: occasionMatch(outfit, context),
    style_match: styleMatch(outfit, profile),
    garment_type_preference: typeMatch(outfit, profile),
    color_preference: colorPreference(outfit, profile),
    color_harmony: colorHarmony(outfit),
    weather_suitability: weatherSuitability(outfit, context),
    context_layer: contextLayer(outfit, context, config),
  };
}

function reasonsFor(features, feedback, context, config) {
  const reasons = [];
  const codes = [];
  const add = (code, text) => {
    codes.push(code);
    reasons.push(text);
  };
  const threshold = config.reasonThreshold;
  const weighted = (name) => features[name] != null && config.weights[name] > 0 && features[name] >= threshold;
  if (weighted("occasion_match")) add("occasion", "Matches the selected occasion");
  if (weighted("style_match")) add("style", "Matches your stated style preferences");
  if (weighted("garment_type_preference")) add("garment_type", "Uses garment types you prefer");
  if (weighted("color_preference")) add("color_preference", "Uses colors you have said you like");
  if (
    features.color_harmony != null &&
    config.weights.color_harmony > 0 &&
    features.color_harmony >= config.colorHarmonyReasonThreshold
  ) {
    add("color_harmony", "Uses colors that are easy to wear together");
  }
  if (weighted("weather_suitability")) add("weather", "Fits the available weather information");
  if (weighted("context_layer")) {
    if (suggestsCoolLayer(context, config)) add("context_layer", "Adds a layer for the cooler conditions");
    else add("context_layer", "Adds a tailored layer for the occasion");
  }
  if (feedback.positive && feedback.value != null && feedback.value >= threshold && config.feedbackAdjustmentWeight > 0) {
    add("feedback", "Agrees with outfits you have liked, saved, worn, or purchased");
  }
  if (!reasons.length) {
    add("wardrobe", "Built from pieces in your wardrobe that passed the outfit rules");
  }
  return { reasons, reason_codes: codes };
}

function attachMarketplaceReason(explanation, outfit) {
  if (!(outfit.marketplace_ids ?? []).length) return explanation;
  explanation.reasons = [
    "Includes a marketplace piece that complements your wardrobe",
    ...explanation.reasons,
  ].slice(0, 3);
  if (!explanation.reason_codes.includes("marketplace")) {
    explanation.reason_codes = ["marketplace", ...explanation.reason_codes].slice(0, 4);
  }
  return explanation;
}

export function scoreOutfit(outfit, context, profile, events, config, learnedModel = null, userModel = null) {
  const features = contentFeatures(outfit, context, profile, config);
  const feedback = feedbackSignal(outfit, events, config);
  let weightSum = 0;
  let valueSum = 0;
  const signalsUsed = [];
  for (const [name, value] of Object.entries(features)) {
    if (value == null || !(config.weights[name] > 0)) continue;
    weightSum += config.weights[name];
    valueSum += config.weights[name] * value;
    signalsUsed.push(name);
  }
  let baselineScore = weightSum === 0 ? config.uninformedScore : valueSum / weightSum;
  const linucbReady = Boolean(userModel?.ready && config.personalization === "linucb");
  // Heuristic affinity stays on when LinUCB is off or not ready yet.
  if (!linucbReady && feedback.value != null && config.feedbackAdjustmentWeight > 0) {
    baselineScore += config.feedbackAdjustmentWeight * (feedback.value - 0.5);
    signalsUsed.push("feedback_affinity");
  }
  baselineScore = round4(clamp01(baselineScore));

  let score = baselineScore;
  let rankingMethod = "baseline_weighted_features";
  let learnedApplied = false;
  if (learnedModel && config.rankingPolicy === "learned") {
    const vector = buildLearnedVector(features, context, outfit);
    score = scoreLearnedVector(learnedModel, vector);
    signalsUsed.push("learned_ranker");
    rankingMethod = "learned_mlp_ranker";
    learnedApplied = true;
  }

  let personalizationApplied = false;
  if (linucbReady) {
    const personalized = personalizeScore(score, features, userModel, config);
    score = round4(clamp01(personalized.score));
    if (personalized.applied) {
      personalizationApplied = true;
      signalsUsed.push("linucb_personalization");
      rankingMethod = learnedApplied
        ? "learned_mlp_plus_linucb"
        : "baseline_plus_linucb";
    }
  }

  const market = marketplaceAffinity(outfit, events, config);
  if (market.value != null && (config.marketplaceAffinityWeight ?? 0.08) > 0) {
    score = round4(clamp01(score + (config.marketplaceAffinityWeight ?? 0.08) * (market.value - 0.5)));
    signalsUsed.push("marketplace_affinity");
  }

  let explanation = reasonsFor(features, feedback, context, config);
  if (learnedApplied) {
    explanation.reasons = [
      "Ranked by Closette's learned Muse outfit model",
      ...explanation.reasons.filter((reason) => reason !== "Built from pieces in your wardrobe that passed the outfit rules"),
    ].slice(0, 3);
    if (!explanation.reason_codes.includes("learned_ranker")) {
      explanation.reason_codes = ["learned_ranker", ...explanation.reason_codes].slice(0, 4);
    }
  }
  if (personalizationApplied) {
    explanation.reasons = [
      "Personalized from your likes, saves, wears, dismissals, and purchases",
      ...explanation.reasons,
    ].slice(0, 3);
    if (!explanation.reason_codes.includes("linucb")) {
      explanation.reason_codes = ["linucb", ...explanation.reason_codes].slice(0, 4);
    }
  }
  explanation = attachMarketplaceReason(explanation, outfit);

  return {
    ...outfit,
    score,
    baseline_score: baselineScore,
    features: {
      ...features,
      feedback_affinity: feedback.value,
      marketplace_affinity: market.value,
    },
    signals_used: signalsUsed,
    feedback_applied: feedback.value != null || personalizationApplied || market.value != null,
    learned_applied: learnedApplied,
    personalization_applied: personalizationApplied,
    ranking_method: rankingMethod,
    reasons: explanation.reasons,
    reason_codes: explanation.reason_codes,
  };
}

export function rankOutfits(candidates, context, profile, events, config, learnedModel = null, userModel = null) {
  const ranked = candidates.map((candidate) =>
    scoreOutfit(candidate, context, profile, events, config, learnedModel, userModel),
  );
  ranked.sort((a, b) => b.score - a.score || a.outfitId.localeCompare(b.outfitId));
  return ranked;
}

function sharedCore(left, right) {
  const ids = new Set(left);
  return right.filter((id) => ids.has(id)).length;
}

/**
 * Keep higher scores first, and prefer a later outfit when it shares fewer
 * core garments than one already chosen. The returned score is the rank score.
 */
export function selectDiverse(ranked, limit, config) {
  const accepted = [];
  const deferred = [];
  for (const outfit of ranked) {
    if (accepted.length >= limit) break;
    const crowded = accepted.some((chosen) => sharedCore(chosen.coreIds, outfit.coreIds) >= config.diversityMaxSharedCore);
    if (crowded) deferred.push(outfit);
    else accepted.push(outfit);
  }
  for (const outfit of deferred) {
    if (accepted.length >= limit) break;
    accepted.push(outfit);
  }
  return accepted;
}
