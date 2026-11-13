/** Closette vocabulary Muse is allowed to read. Values match ml/garment. */

export const MODEL_VERSION = "muse-v1";
export const API_VERSION = "v1";

export const TAXONOMY = {
  tops: ["t-shirt", "shirt", "polo", "blouse", "sweater", "hoodie", "tank-top", "sweatshirt"],
  bottoms: ["jeans", "trousers", "chinos", "shorts", "skirt", "leggings"],
  "one-piece": ["dress", "jumpsuit", "romper"],
  outerwear: ["jacket", "coat", "blazer", "trench-coat", "raincoat"],
  footwear: ["sneakers", "boots", "sandals", "formal-shoes", "flats", "heels"],
  accessories: ["hat", "scarf", "belt", "bag", "gloves", "other-accessories"],
};

export const CATEGORY_ROLE = {
  tops: "top",
  bottoms: "bottom",
  "one-piece": "one_piece",
  outerwear: "outerwear",
  footwear: "footwear",
  accessories: "accessory",
};

export const SUBCATEGORY_CATEGORY = Object.fromEntries(
  Object.entries(TAXONOMY).flatMap(([category, subs]) => subs.map((sub) => [sub, category])),
);

export const COLOR_NAMES = [
  "black",
  "white",
  "off-white",
  "grey",
  "charcoal",
  "red",
  "burgundy",
  "pink",
  "orange",
  "yellow",
  "mustard",
  "green",
  "olive",
  "mint",
  "blue",
  "navy",
  "sky blue",
  "purple",
  "lavender",
  "brown",
  "tan",
  "beige",
  "cream",
  "multicolor",
];

/** Used only as a soft harmony bonus. Never as a reject list. */
export const NEUTRAL_COLORS = new Set([
  "black",
  "white",
  "off-white",
  "grey",
  "charcoal",
  "beige",
  "cream",
  "tan",
  "brown",
  "navy",
]);

export const COLOR_FAMILIES = {
  red: "red",
  burgundy: "red",
  pink: "pink",
  orange: "orange",
  yellow: "yellow",
  mustard: "yellow",
  green: "green",
  olive: "green",
  mint: "green",
  blue: "blue",
  "sky blue": "blue",
  purple: "purple",
  lavender: "purple",
};

export const SEASONS = ["spring", "summer", "fall", "winter"];

export const KNOWN_OCCASIONS = ["casual", "smart-casual", "work", "formal"];

export const FEEDBACK_ACTIONS = ["like", "save", "dislike", "dismiss", "worn", "purchase"];
export const FEEDBACK_SOURCES = ["wardrobe", "marketplace"];

/** A reason code that names what was wrong. "other" stays weak. */
export const SPECIFIC_DISLIKE_REASONS = new Set(["color", "formality", "weather", "style", "comfort"]);

export const ROLE_ORDER = ["one_piece", "top", "bottom", "footwear", "outerwear", "accessory"];

export function normToken(value) {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase().replace(/\s+/g, " ");
  return token.length ? token : null;
}

export function normSeason(value) {
  const token = normToken(value);
  if (token === "autumn") return "fall";
  return token;
}

export function normFormality(value) {
  const token = normToken(value);
  if (token === "smart casual") return "smart-casual";
  return token;
}

export function normAvailability(value) {
  const token = normToken(value);
  if (token === "in laundry" || token === "in_laundry") return "laundry";
  return token;
}
