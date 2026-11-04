import { createHash } from "node:crypto";
import { MODEL_VERSION } from "./schemas/constants.js";

export function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function outfitIdFor(itemIds) {
  return `outfit-${shortHash([...itemIds].sort().join(","))}`;
}

export function recommendationIdFor(userId, context, outfitIds) {
  const weather = context.weather;
  const payload = JSON.stringify({
    model: MODEL_VERSION,
    userId,
    occasion: context.occasion,
    season: context.season,
    temperature_c: weather?.temperature_c ?? null,
    condition: weather?.condition ?? null,
    outfitIds,
  });
  return `rec-${shortHash(payload)}`;
}
