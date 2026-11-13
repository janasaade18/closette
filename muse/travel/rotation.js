/**
 * Choose one outfit per day from ranked candidates with rotation pressure.
 * Discourages repeating the same core garments beyond maxCoreReuses.
 */

function coreKey(outfit) {
  const roles = outfit.roles ?? {};
  if (roles.one_piece) return `one:${roles.one_piece}|${roles.footwear ?? ""}`;
  return `sep:${roles.top ?? ""}|${roles.bottom ?? ""}|${roles.footwear ?? ""}`;
}

function reusePenalty(outfit, usage, maxCoreReuses) {
  let penalty = 0;
  for (const id of outfit.items ?? []) {
    const used = usage.get(id) ?? 0;
    if (used > maxCoreReuses) penalty += 0.35 * (used - maxCoreReuses);
    else if (used > 0) penalty += 0.08 * used;
  }
  const core = coreKey(outfit);
  const coreUsed = usage.get(`core:${core}`) ?? 0;
  if (coreUsed > 0) penalty += 0.45 * coreUsed;
  return penalty;
}

export function selectRotatingOutfits(dayCandidates, luggage) {
  const preferRewear = luggage.preferRewear !== false;
  const maxCoreReuses = luggage.maxCoreReuses ?? 1;
  const usage = new Map();
  const selected = [];

  for (const day of dayCandidates) {
    const options = day.candidates ?? [];
    if (!options.length) {
      selected.push({
        date: day.date,
        label: day.label,
        occasion: day.occasion,
        weather: day.weather,
        season: day.season,
        outfit: null,
        status: "insufficient_candidates",
        rotation_penalty: null,
      });
      continue;
    }

    let best = null;
    let bestScore = -Infinity;
    for (const outfit of options) {
      const penalty = preferRewear
        ? reusePenalty(outfit, usage, maxCoreReuses) * 0.5
        : reusePenalty(outfit, usage, maxCoreReuses);
      // When prefer_rewear is true, mild reuse of non-core pieces is cheaper than packing new items,
      // but repeating the exact core still costs.
      const adjusted = (outfit.score ?? 0) - penalty;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = { outfit, penalty };
      }
    }

    const chosen = best.outfit;
    for (const id of chosen.items ?? []) {
      usage.set(id, (usage.get(id) ?? 0) + 1);
    }
    usage.set(`core:${coreKey(chosen)}`, (usage.get(`core:${coreKey(chosen)}`) ?? 0) + 1);

    selected.push({
      date: day.date,
      label: day.label,
      occasion: day.occasion,
      weather: day.weather,
      season: day.season,
      outfit: chosen,
      status: "ok",
      rotation_penalty: best.penalty,
      selection_score: bestScore,
    });
  }

  return selected;
}

export { coreKey };
