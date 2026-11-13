/**
 * Learn from marketplace interactions (purchase/like/save with source=marketplace
 * or product_ids). Soft nudge on mixed outfits; Phase 2 LinUCB still learns from
 * full recommendation feature snapshots.
 */
import { clamp01 } from "../util.js";

function eventProductIds(event) {
  const ids = new Set();
  for (const id of event.product_ids ?? []) ids.add(String(id));
  for (const id of event.garment_ids ?? []) ids.add(String(id));
  return ids;
}

export function marketplaceAffinity(outfit, events, config = {}) {
  const minEvents = config.personalizationMinEvents ?? config.feedbackMinEvents ?? 3;
  const marketplaceEvents = (events ?? []).filter(
    (event) => event.source === "marketplace" || (event.product_ids && event.product_ids.length),
  );
  if (marketplaceEvents.length < minEvents) {
    return { value: null, hits: 0 };
  }

  const outfitMarketIds = new Set(outfit.marketplace_ids ?? []);
  for (const item of outfit.items ?? []) {
    if (item.source === "marketplace") outfitMarketIds.add(item.id);
  }
  if (!outfitMarketIds.size) return { value: null, hits: 0 };

  let raw = 0;
  let hits = 0;
  for (const event of marketplaceEvents) {
    const ids = eventProductIds(event);
    const overlap = [...outfitMarketIds].filter((id) => ids.has(id));
    if (!overlap.length) continue;
    hits += 1;
    if (event.action === "purchase") raw += 1.2;
    else if (event.action === "like" || event.action === "save") raw += 1;
    else if (event.action === "worn") raw += 0.9;
    else if (event.action === "dislike") raw -= 1;
    else if (event.action === "dismiss") raw -= 0.2;
  }

  if (!hits) return { value: null, hits: 0 };
  return { value: clamp01(1 / (1 + Math.exp(-raw))), hits };
}
