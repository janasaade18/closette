import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export function museRoot() {
  return root;
}

export function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

export function defaultConfig() {
  const runtime = readJson("config/runtime.json");
  const weightsDoc = readJson("ranking/weights.json");
  const rules = readJson("compatibility_rules/config.json");
  return {
    modelVersion: runtime.model_version,
    apiVersion: runtime.api_version,
    limitDefault: runtime.limit_default,
    limitMax: runtime.limit_max,
    slotBeam: runtime.slot_beam,
    maxCandidates: runtime.max_candidates,
    outerwearBeam: runtime.outerwear_beam,
    accessoryBeam: runtime.accessory_beam,
    coldTempC: runtime.cold_temp_c,
    coolSeasons: [...runtime.cool_seasons],
    feedbackMinEvents: runtime.feedback_min_events,
    personalization: runtime.personalization ?? "baseline",
    personalizationBlend: runtime.personalization_blend ?? 0.28,
    personalizationMinEvents: runtime.personalization_min_events ?? runtime.feedback_min_events ?? 3,
    linucbAlpha: runtime.linucb_alpha ?? 0.8,
    linucbExplore: runtime.linucb_explore ?? false,
    diversityMaxSharedCore: runtime.diversity_max_shared_core,
    rankingPolicy: runtime.ranking_policy ?? "baseline",
    learnedModelPath: runtime.learned_model_path ?? null,
    marketplaceEnabled: runtime.marketplace_enabled ?? false,
    marketplaceCatalogPath: runtime.marketplace_catalog_path ?? null,
    marketplaceMaxProducts: runtime.marketplace_max_products ?? 24,
    marketplaceMaxItemsPerOutfit: runtime.marketplace_max_items_per_outfit ?? 1,
    marketplaceMaxMixedCandidates: runtime.marketplace_max_mixed_candidates ?? 120,
    marketplaceAffinityWeight: runtime.marketplace_affinity_weight ?? 0.08,
    travelMaxDays: runtime.travel_max_days ?? 14,
    travelMaxItems: runtime.travel_max_items ?? 16,
    travelMaxWeightKg: runtime.travel_max_weight_kg ?? null,
    travelCandidatesPerDay: runtime.travel_candidates_per_day ?? 4,
    weights: { ...weightsDoc.weights },
    feedbackAdjustmentWeight: weightsDoc.feedback_adjustment_weight,
    uninformedScore: weightsDoc.uninformed_score,
    reasonThreshold: weightsDoc.reason_threshold,
    colorHarmonyReasonThreshold: weightsDoc.color_harmony_reason_threshold,
    rules,
  };
}
