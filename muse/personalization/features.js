/**
 * Build the LinUCB feature vector from a Muse content-feature snapshot.
 * Matches research/contextual_bandits.md: the seven baseline signals.
 */
import { BASELINE_FEATURES } from "./linucb.js";

const MISSING_FILL = 0.5;

export function vectorFromContentFeatures(features) {
  if (!features || typeof features !== "object") return null;
  return BASELINE_FEATURES.map((name) => {
    const value = features[name];
    if (value == null || Number.isNaN(Number(value))) return MISSING_FILL;
    return Number(value);
  });
}

export function findOutfitSnapshot(recommendation, outfitId) {
  if (!recommendation) return null;
  const shown = recommendation.shown ?? [];
  const rest = recommendation.eligible_not_shown ?? [];
  return shown.concat(rest).find((entry) => entry.outfit_id === outfitId) ?? null;
}
