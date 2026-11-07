import { SEASONS, normSeason, normToken } from "./constants.js";
import { apiError } from "../util.js";

const REQUEST_FIELDS = new Set([
  "user_id",
  "occasion",
  "weather",
  "season",
  "limit",
  "wardrobe",
  "wardrobe_item_ids",
  "profile",
  "preferences_override",
  "personalization",
]);

const PROFILE_FIELDS = [
  "preferred_styles",
  "favorite_colors",
  "disliked_colors",
  "preferred_garment_types",
  "explicit_preferences",
  "avoid_garment_ids",
  "avoid_subcategories",
  "avoid_categories",
];

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function readStringArray(value, field, errors, { allowEmpty = false } = {}) {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    errors[field] = "must be an array of strings";
    return undefined;
  }
  const cleaned = [];
  for (const entry of value) {
    if (typeof entry !== "string" || (!allowEmpty && !entry.trim())) {
      errors[field] = "must be an array of non-empty strings";
      return undefined;
    }
    cleaned.push(entry.trim());
  }
  return cleaned;
}

function readProfile(value, field, errors) {
  if (value == null) return undefined;
  if (!isObject(value)) {
    errors[field] = "must be an object";
    return undefined;
  }
  const profile = {};
  for (const key of PROFILE_FIELDS) {
    if (value[key] != null) {
      profile[key] = readStringArray(value[key], `${field}.${key}`, errors, {
        allowEmpty: key === "explicit_preferences",
      });
    }
  }
  return profile;
}

function readGarment(value, index, errors) {
  const field = `wardrobe[${index}]`;
  if (!isObject(value)) {
    errors[field] = "must be an object";
    return;
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    errors[field] = "id must be a non-empty string";
  }
  for (const key of ["category", "subcategory", "pattern", "formality", "availability", "primary_color", "season"]) {
    if (value[key] != null && typeof value[key] !== "string") {
      errors[`${field}.${key}`] = "must be a string";
    }
  }
  for (const key of ["style_tags", "seasons", "secondary_colors", "unsuitable_conditions", "incompatible_with"]) {
    if (value[key] != null) readStringArray(value[key], `${field}.${key}`, errors);
  }
  if (value.colors != null) {
    if (!isObject(value.colors)) {
      errors[`${field}.colors`] = "must be an object";
    } else {
      if (value.colors.primary != null && typeof value.colors.primary !== "string") {
        errors[`${field}.colors.primary`] = "must be a string";
      }
      if (value.colors.secondary != null) {
        readStringArray(value.colors.secondary, `${field}.colors.secondary`, errors);
      }
    }
  }
  if (value.temperature_range_c != null) {
    const range = value.temperature_range_c;
    if (!isObject(range)) {
      errors[`${field}.temperature_range_c`] = "must be an object";
    } else {
      if (range.min_c != null && !finiteNumber(range.min_c)) errors[`${field}.temperature_range_c.min_c`] = "must be a number";
      if (range.max_c != null && !finiteNumber(range.max_c)) errors[`${field}.temperature_range_c.max_c`] = "must be a number";
      if (finiteNumber(range.min_c) && finiteNumber(range.max_c) && range.min_c > range.max_c) {
        errors[`${field}.temperature_range_c`] = "min_c cannot be greater than max_c";
      }
    }
  }
}

export function validateRecommendRequest(body, config) {
  if (!isObject(body)) {
    return { error: apiError(400, "invalid_request", "Request body must be a JSON object.") };
  }
  const errors = {};
  const unknown = Object.keys(body).filter((key) => !REQUEST_FIELDS.has(key));
  if (body.personalization != null && body.personalization !== "baseline") {
    return {
      error: apiError(
        400,
        "personalization_not_available",
        "The request path uses the baseline ranker. LinUCB is not enabled.",
      ),
    };
  }
  if (typeof body.user_id !== "string" || !body.user_id.trim()) {
    errors.user_id = "must be a non-empty string";
  }
  if (body.occasion != null && (typeof body.occasion !== "string" || !body.occasion.trim() || body.occasion.trim().length > 80)) {
    errors.occasion = "must be a string of 1 to 80 characters";
  }
  if (body.season != null) {
    const season = normSeason(body.season);
    if (typeof body.season !== "string" || !SEASONS.includes(season)) {
      errors.season = "must be spring, summer, fall, or winter";
    }
  }
  if (body.weather != null) {
    if (!isObject(body.weather)) {
      errors.weather = "must be an object";
    } else {
      if (body.weather.temperature_c != null && (!finiteNumber(body.weather.temperature_c) || body.weather.temperature_c < -80 || body.weather.temperature_c > 60)) {
        errors["weather.temperature_c"] = "must be a number from -80 to 60";
      }
      if (body.weather.condition != null && (typeof body.weather.condition !== "string" || !body.weather.condition.trim())) {
        errors["weather.condition"] = "must be a non-empty string";
      }
    }
  }
  let limit = config.limitDefault;
  if (body.limit != null) {
    if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > config.limitMax) {
      errors.limit = `must be an integer from 1 to ${config.limitMax}`;
    } else {
      limit = body.limit;
    }
  }
  if (body.wardrobe != null && !Array.isArray(body.wardrobe)) {
    errors.wardrobe = "must be an array";
  }
  if (Array.isArray(body.wardrobe)) {
    const seen = new Set();
    body.wardrobe.forEach((garment, index) => {
      readGarment(garment, index, errors);
      if (garment && typeof garment.id === "string") {
        const id = garment.id.trim();
        if (seen.has(id)) errors.wardrobe = `duplicate garment id ${id}`;
        seen.add(id);
      }
    });
  }
  const wardrobeIds = readStringArray(body.wardrobe_item_ids, "wardrobe_item_ids", errors);
  if (body.wardrobe == null && body.wardrobe_item_ids == null) {
    errors.wardrobe = "provide wardrobe or wardrobe_item_ids";
  }
  const profile = readProfile(body.profile, "profile", errors);
  const preferences = readProfile(body.preferences_override, "preferences_override", errors);
  if (Object.keys(errors).length) {
    return { error: apiError(400, "invalid_request", "The recommendation request is invalid.", errors) };
  }

  const weather = body.weather
    ? {
        temperature_c: body.weather.temperature_c ?? null,
        condition: body.weather.condition ? normToken(body.weather.condition) : null,
      }
    : null;
  return {
    value: {
      userId: body.user_id.trim(),
      limit,
      context: {
        occasion: body.occasion ? normToken(body.occasion) : null,
        season: body.season ? normSeason(body.season) : null,
        weather,
      },
      wardrobe: body.wardrobe ?? null,
      wardrobeItemIds: wardrobeIds ?? null,
      profile: profile ?? {},
      preferencesOverride: preferences ?? {},
      unknownFields: unknown,
    },
  };
}

export function validateFeedbackRequest(body) {
  if (!isObject(body)) {
    return { error: apiError(400, "invalid_feedback", "Feedback body must be a JSON object.") };
  }
  const errors = {};
  if (typeof body.recommendation_id !== "string" || !body.recommendation_id.trim()) {
    errors.recommendation_id = "must be a non-empty string";
  }
  if (typeof body.outfit_id !== "string" || !body.outfit_id.trim()) {
    errors.outfit_id = "must be a non-empty string";
  }
  const actions = ["like", "save", "dislike", "dismiss", "worn"];
  if (!actions.includes(body.action)) {
    errors.action = `must be one of ${actions.join(", ")}`;
  }
  if (body.user_id != null && (typeof body.user_id !== "string" || !body.user_id.trim())) {
    errors.user_id = "must be a non-empty string";
  }
  if (body.timestamp != null && (typeof body.timestamp !== "string" || Number.isNaN(Date.parse(body.timestamp)))) {
    errors.timestamp = "must be an ISO-8601 timestamp";
  }
  if (body.reason != null) {
    if (!isObject(body.reason)) {
      errors.reason = "must be an object";
    } else {
      if (body.reason.code != null && typeof body.reason.code !== "string") errors["reason.code"] = "must be a string";
      if (body.reason.note != null && typeof body.reason.note !== "string") errors["reason.note"] = "must be a string";
    }
  }
  if (Object.keys(errors).length) {
    return { error: apiError(400, "invalid_feedback", "The feedback request is invalid.", errors) };
  }
  return {
    value: {
      recommendationId: body.recommendation_id.trim(),
      outfitId: body.outfit_id.trim(),
      action: body.action,
      userId: body.user_id ? body.user_id.trim() : null,
      timestamp: body.timestamp ?? null,
      reason: body.reason
        ? {
            code: body.reason.code ? normToken(body.reason.code) : null,
            note: typeof body.reason.note === "string" ? body.reason.note.trim() : null,
          }
        : null,
    },
  };
}
