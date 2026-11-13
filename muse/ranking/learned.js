/**
 * Node inference for muse-ranker-v1 (MLP exported from ml/muse/train_ranker.py).
 * Candidate generation and hard rules stay unchanged; this only re-scores outfits.
 */
import fs from "node:fs";
import path from "node:path";
import { museRoot } from "../config.js";
import { clamp01, round4 } from "../util.js";

export const LEARNED_FEATURE_NAMES = [
  "occasion_match",
  "style_match",
  "garment_type_preference",
  "color_preference",
  "color_harmony",
  "weather_suitability",
  "context_layer",
  "temp_norm",
  "occasion_casual",
  "occasion_smart_casual",
  "occasion_work",
  "occasion_formal",
  "season_spring",
  "season_summer",
  "season_fall",
  "season_winter",
  "has_outerwear",
  "n_items_norm",
];

const MISSING_FILL = 0.5;
const OCCASIONS = ["casual", "smart-casual", "work", "formal"];
const SEASONS = ["spring", "summer", "fall", "winter"];

function tempNorm(temperatureC) {
  if (typeof temperatureC !== "number") return MISSING_FILL;
  return Math.max(0, Math.min(1, (temperatureC + 20) / 60));
}

function oneHot(value, choices) {
  return choices.map((choice) => (value === choice ? 1 : 0));
}

function fill(value) {
  return value == null ? MISSING_FILL : Number(value);
}

export function buildLearnedVector(contentFeatures, context, outfit) {
  const temperatureC = context.weather?.temperature_c;
  const occasion = context.occasion ?? null;
  const season = context.season ?? null;
  const hasOuterwear = Boolean(outfit.roles?.outerwear);
  const nItems = Array.isArray(outfit.itemIds) ? outfit.itemIds.length : outfit.items?.length ?? 0;
  return [
    fill(contentFeatures.occasion_match),
    fill(contentFeatures.style_match),
    fill(contentFeatures.garment_type_preference),
    fill(contentFeatures.color_preference),
    fill(contentFeatures.color_harmony),
    fill(contentFeatures.weather_suitability),
    fill(contentFeatures.context_layer),
    tempNorm(temperatureC),
    ...oneHot(occasion, OCCASIONS),
    ...oneHot(season, SEASONS),
    hasOuterwear ? 1 : 0,
    Math.max(0, Math.min(1, nItems / 5)),
  ];
}

function activate(values, name) {
  if (name === "relu") return values.map((value) => Math.max(0, value));
  if (name === "logistic") return values.map((value) => 1 / (1 + Math.exp(-value)));
  throw new Error(`Unsupported activation: ${name}`);
}

function matvec(matrix, vector) {
  // matrix is rows of input-dim; sklearn coef shape (n_in, n_out) stored as list of n_in rows.
  const outDim = matrix[0].length;
  const result = new Array(outDim).fill(0);
  for (let i = 0; i < matrix.length; i += 1) {
    const row = matrix[i];
    const x = vector[i];
    for (let j = 0; j < outDim; j += 1) result[j] += x * row[j];
  }
  return result;
}

export function scoreLearnedVector(model, vector) {
  if (!model?.layers?.length) throw new Error("Learned model has no layers");
  if (vector.length !== model.feature_names.length) {
    throw new Error(`Expected ${model.feature_names.length} features, got ${vector.length}`);
  }
  const mean = model.scaler.mean;
  const scale = model.scaler.scale;
  let hidden = vector.map((value, index) => (value - mean[index]) / scale[index]);
  for (const layer of model.layers) {
    const biased = matvec(layer.weight, hidden).map((value, index) => value + layer.bias[index]);
    hidden = activate(biased, layer.activation);
  }
  return round4(clamp01(hidden[0]));
}

export function defaultLearnedWeightsPath() {
  return path.join(museRoot(), "..", "ml", "muse", "weights", "ranker-v1.json");
}

export function loadLearnedModel(filePath = defaultLearnedWeightsPath()) {
  if (!fs.existsSync(filePath)) return null;
  const model = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(model.feature_names) || model.feature_names.length !== LEARNED_FEATURE_NAMES.length) {
    throw new Error("Learned model feature_names do not match LEARNED_FEATURE_NAMES");
  }
  for (let i = 0; i < LEARNED_FEATURE_NAMES.length; i += 1) {
    if (model.feature_names[i] !== LEARNED_FEATURE_NAMES[i]) {
      throw new Error(`Feature mismatch at ${i}: ${model.feature_names[i]} vs ${LEARNED_FEATURE_NAMES[i]}`);
    }
  }
  return model;
}
