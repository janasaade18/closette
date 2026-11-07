import {
  CATEGORY_ROLE,
  SEASONS,
  SUBCATEGORY_CATEGORY,
  normAvailability,
  normFormality,
  normSeason,
  normToken,
} from "./constants.js";

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normToken(entry)).filter(Boolean);
}

function readColors(raw) {
  const block = raw.colors && typeof raw.colors === "object" && !Array.isArray(raw.colors) ? raw.colors : {};
  const primary = normToken(block.primary ?? raw.primary_color);
  const secondarySource = Array.isArray(block.secondary)
    ? block.secondary
    : Array.isArray(raw.secondary_colors)
      ? raw.secondary_colors
      : [];
  return {
    primary,
    secondary: secondarySource.map((entry) => normToken(entry)).filter(Boolean),
  };
}

function readSeasons(raw) {
  if (raw.seasons == null && raw.season == null) {
    return { known: false, list: [] };
  }
  const source = raw.seasons != null ? raw.seasons : [raw.season];
  const list = [...new Set((Array.isArray(source) ? source : [source]).map((entry) => normSeason(entry)).filter((entry) => SEASONS.includes(entry)))];
  return { known: list.length > 0, list };
}

function readRange(raw) {
  const range = raw.temperature_range_c;
  if (range == null || typeof range !== "object") {
    return { min: null, max: null };
  }
  return {
    min: typeof range.min_c === "number" ? range.min_c : null,
    max: typeof range.max_c === "number" ? range.max_c : null,
  };
}

/**
 * Copy only known garment fields. Omitted attributes stay null or empty.
 * A known taxonomy subcategory can fill a missing category. Nothing else is inferred.
 */
export function normalizeGarment(raw) {
  let category = normToken(raw.category);
  const subcategory = normToken(raw.subcategory);
  if (!category && subcategory && SUBCATEGORY_CATEGORY[subcategory]) {
    category = SUBCATEGORY_CATEGORY[subcategory];
  }
  const seasons = readSeasons(raw);
  const range = readRange(raw);
  return {
    id: String(raw.id).trim(),
    category,
    subcategory,
    colors: readColors(raw),
    pattern: normToken(raw.pattern),
    seasons: seasons.list,
    seasonsKnown: seasons.known,
    temperatureMin: range.min,
    temperatureMax: range.max,
    formality: normFormality(raw.formality),
    styleTags: stringList(raw.style_tags),
    availability: normAvailability(raw.availability),
    unsuitableConditions: stringList(raw.unsuitable_conditions),
    incompatibleWith: stringList(raw.incompatible_with),
    role: category ? (CATEGORY_ROLE[category] ?? null) : null,
  };
}
