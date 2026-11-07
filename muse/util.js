import { API_VERSION, MODEL_VERSION } from "./schemas/constants.js";

export function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function round4(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function apiError(statusCode, error, message, fields) {
  return {
    statusCode,
    body: {
      api_version: API_VERSION,
      model_version: MODEL_VERSION,
      status: "error",
      error,
      message,
      ...(fields ? { fields } : {}),
    },
  };
}

export const SCORE_SEMANTICS = "weighted_average_of_active_features_not_a_probability";

export const SCORE_NOTE =
  "Scores run from 0 to 1. They are a weighted average of the signals that had evidence, plus a small feedback adjustment when enough history exists. They are not probabilities.";
