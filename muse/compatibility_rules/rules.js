import { TAXONOMY, SUBCATEGORY_CATEGORY } from "../schemas/constants.js";

export const RULE = {
  missingCategory: "missing_category",
  unknownCategory: "unknown_category",
  categoryMismatch: "category_subcategory_mismatch",
  unavailable: "unavailable",
  avoidGarment: "avoid_garment",
  avoidCategory: "avoid_category",
  avoidSubcategory: "avoid_subcategory",
  dislikedColor: "disliked_color",
  occasionFormality: "occasion_formality",
  temperatureRange: "temperature_range",
  season: "season",
  unsuitableCondition: "unsuitable_condition",
  duplicateGarment: "duplicate_garment",
  explicitIncompatibility: "explicit_incompatibility",
};

function pushOnce(reasons, rule) {
  if (!reasons.includes(rule)) reasons.push(rule);
}

/**
 * Item-level hard rules. A rule fires only when the garment and the request
 * both carry the field that rule reads. Missing metadata is not a violation.
 */
export function itemViolations(item, context, profile, config) {
  const reasons = [];
  const rules = config.rules;

  if (!item.category) {
    pushOnce(reasons, RULE.missingCategory);
  } else if (!Object.prototype.hasOwnProperty.call(TAXONOMY, item.category)) {
    pushOnce(reasons, RULE.unknownCategory);
  }

  if (item.subcategory && SUBCATEGORY_CATEGORY[item.subcategory] && item.category && SUBCATEGORY_CATEGORY[item.subcategory] !== item.category) {
    pushOnce(reasons, RULE.categoryMismatch);
  }

  if (item.availability && rules.exclude_availability.includes(item.availability)) {
    pushOnce(reasons, RULE.unavailable);
  }
  if (profile.avoidGarmentIds.includes(item.id)) pushOnce(reasons, RULE.avoidGarment);
  if (item.category && profile.avoidCategories.includes(item.category)) pushOnce(reasons, RULE.avoidCategory);
  if (item.subcategory && profile.avoidSubcategories.includes(item.subcategory)) pushOnce(reasons, RULE.avoidSubcategory);
  if (item.colors.primary && profile.dislikedColors.includes(item.colors.primary)) {
    pushOnce(reasons, RULE.dislikedColor);
  }

  const occasion = rules.occasions[context.occasion];
  if (occasion && item.formality && occasion.reject_formality.includes(item.formality)) {
    pushOnce(reasons, RULE.occasionFormality);
  }

  const temp = context.weather?.temperature_c;
  if (typeof temp === "number") {
    const below = item.temperatureMin != null && temp < item.temperatureMin;
    const above = item.temperatureMax != null && temp > item.temperatureMax;
    if (below || above) pushOnce(reasons, RULE.temperatureRange);
  }

  if (context.season && item.seasonsKnown && item.seasons.length && !item.seasons.includes(context.season)) {
    pushOnce(reasons, RULE.season);
  }

  const condition = context.weather?.condition;
  if (condition && item.unsuitableConditions.includes(condition)) {
    pushOnce(reasons, RULE.unsuitableCondition);
  }

  return reasons;
}

export function outfitViolations(outfit) {
  const reasons = [];
  const ids = outfit.items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) pushOnce(reasons, RULE.duplicateGarment);
  for (const item of outfit.items) {
    for (const other of outfit.items) {
      if (other.id === item.id) continue;
      const keys = [other.id, other.subcategory, other.category].filter(Boolean);
      if (item.incompatibleWith.some((token) => keys.includes(token))) {
        pushOnce(reasons, RULE.explicitIncompatibility);
      }
    }
  }
  return reasons;
}

export function partitionItems(items, context, profile, config) {
  const eligible = [];
  const excluded = [];
  for (const item of items) {
    const reasons = itemViolations(item, context, profile, config);
    if (reasons.length) excluded.push({ item_id: item.id, rules: reasons });
    else eligible.push(item);
  }
  return { eligible, excluded };
}
