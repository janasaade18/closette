import { piece, request } from "../tests/helpers.js";

function textOf(body) {
  return (body.recommendations ?? []).flatMap((outfit) => outfit.reasons).join(" ");
}

export const scenarios = [
  {
    id: "new_user",
    title: "New user with no preference history",
    request: request(
      [
        piece("top", "top", { style_tags: ["minimal"] }),
        piece("bottom", "bottom", { style_tags: ["minimal"] }),
        piece("shoes", "shoes", { style_tags: ["minimal"] }),
      ],
      { weather: { temperature_c: 22 } },
    ),
    check(body) {
      const problems = [];
      if (body.status !== "ok") problems.push(`status ${body.status}`);
      if (body.ranking.feedback_events !== 0) problems.push("expected no feedback");
      if (body.ranking.personalization_applied) problems.push("applied personalization without history");
      if (/liked, saved, or worn/i.test(textOf(body))) problems.push("cited learning");
      return problems;
    },
  },
  {
    id: "small_wardrobe",
    title: "Small wardrobe with one possible outfit",
    request: request([piece("top", "top"), piece("bottom", "bottom"), piece("shoes", "shoes")], { limit: 3 }),
    check(body) {
      const problems = [];
      if (body.recommendations.length !== 1) problems.push(`count ${body.recommendations.length}`);
      return problems;
    },
  },
  {
    id: "missing_metadata",
    title: "Missing color and pattern metadata",
    request: request(
      [
        { id: "top", category: "tops", subcategory: "shirt" },
        { id: "bottom", category: "bottoms", subcategory: "trousers" },
        { id: "shoes", category: "footwear", subcategory: "flats" },
      ],
      { occasion: "work" },
    ),
    check(body) {
      const problems = [];
      if (body.status !== "ok") problems.push(`status ${body.status}`);
      if (/navy|black|white|plaid|solid/.test(JSON.stringify(body.recommendations))) {
        problems.push("invented color or pattern");
      }
      return problems;
    },
  },
  {
    id: "formal_mostly_casual",
    title: "Formal occasion with mostly casual garments",
    request: request(
      [
        piece("top", "hoodie", { subcategory: "hoodie", formality: "casual" }),
        piece("bottom", "jeans", { formality: "casual" }),
        piece("shoes", "sneakers", { formality: "casual" }),
        piece("top", "shirt", { subcategory: "shirt", formality: "formal", colors: { primary: "white" } }),
        piece("bottom", "trousers", { subcategory: "trousers", formality: "formal", colors: { primary: "charcoal" } }),
        piece("shoes", "oxfords", { subcategory: "formal-shoes", formality: "formal", colors: { primary: "black" } }),
      ],
      { occasion: "formal", limit: 3 },
    ),
    check(body) {
      const used = new Set((body.recommendations ?? []).flatMap((outfit) => outfit.items));
      const problems = [];
      for (const id of ["hoodie", "jeans", "sneakers"]) {
        if (used.has(id)) problems.push(`kept ${id}`);
      }
      if (!used.has("shirt") || !used.has("trousers") || !used.has("oxfords")) problems.push("missed the formal outfit");
      return problems;
    },
  },
  {
    id: "weather_unavailable",
    title: "Weather data unavailable",
    request: request([
      piece("top", "top", { temperature_range_c: { min_c: 18, max_c: 32 } }),
      piece("bottom", "bottom", { temperature_range_c: { min_c: 18, max_c: 32 } }),
      piece("shoes", "shoes", { temperature_range_c: { min_c: 18, max_c: 32 } }),
    ]),
    check(body) {
      const problems = [];
      if (body.status !== "ok") problems.push(`status ${body.status}`);
      if ((body.recommendations[0]?.reason_codes ?? []).includes("weather")) problems.push("cited weather");
      return problems;
    },
  },
  {
    id: "conflicting_preferences",
    title: "The same color is liked and disliked",
    request: request(
      [
        piece("top", "navy-top"),
        piece("top", "white-top", { colors: { primary: "white" } }),
        piece("bottom", "bottom", { colors: { primary: "black" } }),
        piece("shoes", "shoes", { colors: { primary: "white" } }),
      ],
      { profile: { favorite_colors: ["navy"], disliked_colors: ["navy"] }, limit: 4 },
    ),
    check(body) {
      const problems = [];
      if (!body.warnings.some((warning) => warning.code === "conflicting_color_preference")) {
        problems.push("missing conflict warning");
      }
      const used = (body.recommendations ?? []).flatMap((outfit) => outfit.items);
      if (used.includes("navy-top")) problems.push("used the disliked color");
      if (!used.includes("white-top")) problems.push("dropped the remaining top");
      return problems;
    },
  },
  {
    id: "no_valid_outfit",
    title: "No outfit survives the hard rules",
    request: request(
      [
        piece("top", "top", { formality: "casual" }),
        piece("bottom", "bottom", { formality: "casual" }),
        piece("shoes", "shoes", { formality: "casual" }),
      ],
      { occasion: "formal" },
    ),
    check(body) {
      const problems = [];
      if (body.status !== "insufficient_candidates") problems.push(`status ${body.status}`);
      if (body.recommendations.length !== 0) problems.push("returned an outfit");
      return problems;
    },
  },
  {
    id: "diversity",
    title: "Several outfits from a wider wardrobe",
    request: request(
      [
        piece("top", "top-a"),
        piece("top", "top-b"),
        piece("bottom", "bottom-a"),
        piece("bottom", "bottom-b"),
        piece("shoes", "shoe-a"),
        piece("shoes", "shoe-b"),
      ],
      { limit: 3 },
    ),
    check(body) {
      const problems = [];
      if (body.recommendations.length !== 3) problems.push(`count ${body.recommendations.length}`);
      const tops = new Set(body.recommendations.map((outfit) => outfit.roles.top));
      if (tops.size < 2) problems.push("returned outfits share one top");
      return problems;
    },
  },
  {
    id: "empty_wardrobe",
    title: "Empty wardrobe",
    request: request([]),
    check(body) {
      const problems = [];
      if (body.status !== "empty_wardrobe") problems.push(`status ${body.status}`);
      if (body.recommendations.length !== 0) problems.push("invented an outfit");
      return problems;
    },
  },
];
