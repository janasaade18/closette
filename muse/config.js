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
    personalization: runtime.personalization,
    diversityMaxSharedCore: runtime.diversity_max_shared_core,
    weights: { ...weightsDoc.weights },
    feedbackAdjustmentWeight: weightsDoc.feedback_adjustment_weight,
    uninformedScore: weightsDoc.uninformed_score,
    reasonThreshold: weightsDoc.reason_threshold,
    colorHarmonyReasonThreshold: weightsDoc.color_harmony_reason_threshold,
    rules,
  };
}
