/**
 * Fit a per-user shared LinUCB from logged feedback + recommendation snapshots.
 */
import { SharedLinUCB, BASELINE_FEATURES } from "./linucb.js";
import { rewardForFeedback } from "./rewards.js";
import { findOutfitSnapshot, vectorFromContentFeatures } from "./features.js";

export function fitUserLinUCB(events, store, config = {}) {
  const alpha = config.linucbAlpha ?? 0.8;
  const minEvents = config.personalizationMinEvents ?? config.feedbackMinEvents ?? 3;
  if (!events?.length || events.length < minEvents) {
    return { model: null, updates: 0, ready: false };
  }

  const model = new SharedLinUCB({ dim: BASELINE_FEATURES.length, alpha });
  let updates = 0;
  const ordered = [...events].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

  for (const event of ordered) {
    let vector = null;
    if (store && event.recommendation_id) {
      const recommendation = store.getRecommendation(event.recommendation_id);
      const snapshot = findOutfitSnapshot(recommendation, event.outfit_id);
      vector = vectorFromContentFeatures(snapshot?.features);
    }
    if (!vector && event.features) {
      vector = vectorFromContentFeatures(event.features);
    }
    if (!vector) continue;
    model.update(vector, rewardForFeedback(event.action, event.reason));
    updates += 1;
  }

  return {
    model: updates > 0 ? model : null,
    updates,
    ready: updates >= minEvents,
  };
}

export function personalizeScore(baseScore, contentFeatures, userModel, config = {}) {
  if (!userModel?.ready || !userModel.model) {
    return { score: baseScore, applied: false, mean: null, bonus: null };
  }
  const vector = vectorFromContentFeatures(contentFeatures);
  if (!vector) {
    return { score: baseScore, applied: false, mean: null, bonus: null };
  }
  const scored = userModel.model.score(vector);
  const explore = Boolean(config.linucbExplore);
  const raw = explore ? scored.total : scored.mean;
  const personal = 1 / (1 + Math.exp(-raw));
  const blend = config.personalizationBlend ?? 0.28;
  const score = Math.max(0, Math.min(1, (1 - blend) * baseScore + blend * personal));
  return {
    score,
    applied: true,
    mean: scored.mean,
    bonus: scored.bonus,
    personal,
  };
}
