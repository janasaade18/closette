import { SEASONS, normSeason, normToken } from "../schemas/constants.js";
import { apiError } from "../util.js";

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate POST /v1/travel/pack without changing the single-day recommend contract.
 */
export function validateTravelPackRequest(body, config) {
  if (!isObject(body)) {
    return { error: apiError(400, "invalid_request", "Request body must be a JSON object.") };
  }
  const errors = {};
  if (typeof body.user_id !== "string" || !body.user_id.trim()) {
    errors.user_id = "must be a non-empty string";
  }
  if (body.wardrobe == null && body.wardrobe_item_ids == null) {
    errors.wardrobe = "provide wardrobe or wardrobe_item_ids";
  }
  if (body.wardrobe != null && !Array.isArray(body.wardrobe)) {
    errors.wardrobe = "must be an array";
  }
  if (body.wardrobe_item_ids != null && !Array.isArray(body.wardrobe_item_ids)) {
    errors.wardrobe_item_ids = "must be an array";
  }
  if (!isObject(body.trip) || !Array.isArray(body.trip.days) || body.trip.days.length < 1) {
    errors.trip = "must include days: a non-empty array";
  } else if (body.trip.days.length > (config.travelMaxDays ?? 14)) {
    errors["trip.days"] = `must have at most ${config.travelMaxDays ?? 14} days`;
  }

  const days = [];
  if (Array.isArray(body.trip?.days)) {
    body.trip.days.forEach((day, index) => {
      if (!isObject(day)) {
        errors[`trip.days[${index}]`] = "must be an object";
        return;
      }
      const date = typeof day.date === "string" && day.date.trim() ? day.date.trim() : `day-${index + 1}`;
      if (day.season != null) {
        const season = normSeason(day.season);
        if (!SEASONS.includes(season)) errors[`trip.days[${index}].season`] = "invalid season";
      }
      if (day.weather != null) {
        if (!isObject(day.weather)) {
          errors[`trip.days[${index}].weather`] = "must be an object";
        } else if (
          day.weather.temperature_c != null &&
          (!finiteNumber(day.weather.temperature_c) ||
            day.weather.temperature_c < -80 ||
            day.weather.temperature_c > 60)
        ) {
          errors[`trip.days[${index}].weather.temperature_c`] = "must be a number from -80 to 60";
        }
      }
      days.push({
        date,
        label: typeof day.label === "string" ? day.label.trim() : null,
        occasion: day.occasion ? normToken(day.occasion) : body.occasion ? normToken(body.occasion) : "casual",
        season: day.season ? normSeason(day.season) : body.season ? normSeason(body.season) : null,
        weather: day.weather
          ? {
              temperature_c: day.weather.temperature_c ?? null,
              condition: day.weather.condition ? normToken(day.weather.condition) : null,
            }
          : body.weather
            ? {
                temperature_c: body.weather.temperature_c ?? null,
                condition: body.weather.condition ? normToken(body.weather.condition) : null,
              }
            : null,
      });
    });
  }

  let luggage = {
    maxItems: config.travelMaxItems ?? 16,
    maxWeightKg: config.travelMaxWeightKg ?? null,
    preferRewear: true,
    maxCoreReuses: 1,
  };
  if (body.luggage != null) {
    if (!isObject(body.luggage)) {
      errors.luggage = "must be an object";
    } else {
      if (body.luggage.max_items != null) {
        if (!Number.isInteger(body.luggage.max_items) || body.luggage.max_items < 3 || body.luggage.max_items > 60) {
          errors["luggage.max_items"] = "must be an integer from 3 to 60";
        } else {
          luggage.maxItems = body.luggage.max_items;
        }
      }
      if (body.luggage.max_weight_kg != null) {
        if (!finiteNumber(body.luggage.max_weight_kg) || body.luggage.max_weight_kg <= 0) {
          errors["luggage.max_weight_kg"] = "must be a positive number";
        } else {
          luggage.maxWeightKg = body.luggage.max_weight_kg;
        }
      }
      if (body.luggage.prefer_rewear != null) {
        if (typeof body.luggage.prefer_rewear !== "boolean") {
          errors["luggage.prefer_rewear"] = "must be a boolean";
        } else {
          luggage.preferRewear = body.luggage.prefer_rewear;
        }
      }
      if (body.luggage.max_core_reuses != null) {
        if (!Number.isInteger(body.luggage.max_core_reuses) || body.luggage.max_core_reuses < 0 || body.luggage.max_core_reuses > 5) {
          errors["luggage.max_core_reuses"] = "must be an integer from 0 to 5";
        } else {
          luggage.maxCoreReuses = body.luggage.max_core_reuses;
        }
      }
    }
  }

  if (body.destination != null && !isObject(body.destination)) {
    errors.destination = "must be an object";
  }

  if (Object.keys(errors).length) {
    return { error: apiError(400, "invalid_travel_request", "The travel pack request is invalid.", errors) };
  }

  return {
    value: {
      userId: body.user_id.trim(),
      wardrobe: body.wardrobe ?? null,
      wardrobeItemIds: body.wardrobe_item_ids ?? null,
      profile: body.profile ?? {},
      preferencesOverride: body.preferences_override ?? {},
      personalization: body.personalization ?? null,
      marketplace: body.marketplace ?? null,
      marketplaceProducts: Array.isArray(body.marketplace_products) ? body.marketplace_products : null,
      destination: body.destination
        ? {
            name: typeof body.destination.name === "string" ? body.destination.name.trim() : null,
            country: typeof body.destination.country === "string" ? body.destination.country.trim() : null,
          }
        : null,
      trip: {
        startDate: typeof body.trip.start_date === "string" ? body.trip.start_date.trim() : days[0]?.date ?? null,
        days,
      },
      luggage,
      candidatesPerDay: Number.isInteger(body.candidates_per_day)
        ? Math.min(8, Math.max(2, body.candidates_per_day))
        : config.travelCandidatesPerDay ?? 4,
    },
  };
}
