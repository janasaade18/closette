/** Soft formality affinity. Hard rejects live in compatibility_rules, not here. */
const FORMALITY_RANK = {
  casual: { casual: 1, "smart-casual": 0.75, work: 0.35, formal: 0.1, athletic: 0.7 },
  "smart-casual": { casual: 0.6, "smart-casual": 1, work: 0.75, formal: 0.55, athletic: 0.2 },
  work: { casual: 0.35, "smart-casual": 0.8, work: 1, formal: 0.7, athletic: 0.15 },
  formal: { casual: 0.05, "smart-casual": 0.55, work: 0.65, formal: 1, athletic: 0 },
};

export function formalityAffinity(occasion, formality) {
  const row = FORMALITY_RANK[occasion];
  if (!row || formality == null || row[formality] == null) return null;
  return row[formality];
}

export function itemPreScore(item, context, profile) {
  let score = 0;
  const affinity = formalityAffinity(context.occasion, item.formality);
  if (affinity != null) score += affinity;
  if (item.subcategory && profile.preferredGarmentTypes.includes(item.subcategory)) score += 1;
  if (item.category && profile.preferredGarmentTypes.includes(item.category)) score += 0.5;
  if (item.colors.primary && profile.favoriteColors.includes(item.colors.primary)) score += 1;
  const temp = context.weather?.temperature_c;
  if (typeof temp === "number" && (item.temperatureMin != null || item.temperatureMax != null)) {
    const fits =
      (item.temperatureMin == null || temp >= item.temperatureMin) &&
      (item.temperatureMax == null || temp <= item.temperatureMax);
    if (fits) score += 1;
  }
  return score;
}
