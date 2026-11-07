import { defaultConfig } from "../config.js";
import { buildProfile, recommend } from "../pipeline.js";
import { normalizeGarment } from "../schemas/garment.js";
import { validateRecommendRequest } from "../schemas/validate.js";
import { itemViolations, outfitViolations } from "../compatibility_rules/rules.js";

export function integrityProblems(request, body, config = defaultConfig()) {
  const problems = [];
  const parsed = validateRecommendRequest(request, config);
  if (parsed.error) return ["scenario request failed validation"];
  const { profile } = buildProfile(parsed.value);
  const source = (parsed.value.wardrobe ?? []).map((raw) => normalizeGarment(raw));
  const byId = new Map(source.map((item) => [item.id, item]));
  const seen = new Set();
  for (const outfit of body.recommendations ?? []) {
    if (seen.has(outfit.outfit_id)) problems.push(`duplicate outfit ${outfit.outfit_id}`);
    seen.add(outfit.outfit_id);
    if (!outfit.reasons?.length) problems.push(`${outfit.outfit_id} has no reasons`);
    if (typeof outfit.score !== "number" || outfit.score < 0 || outfit.score > 1) {
      problems.push(`${outfit.outfit_id} score out of range`);
    }
    if (new Set(outfit.items).size !== outfit.items.length) problems.push(`${outfit.outfit_id} repeats a garment`);
    const items = [];
    for (const id of outfit.items) {
      const item = byId.get(id);
      if (!item) {
        problems.push(`${id} is not in the wardrobe`);
        continue;
      }
      items.push(item);
      const violations = itemViolations(item, parsed.value.context, profile, config);
      if (violations.length) problems.push(`${id} breaks ${violations.join(", ")}`);
    }
    if (items.length === outfit.items.length) {
      const violations = outfitViolations({ items });
      if (violations.length) problems.push(`${outfit.outfit_id} breaks ${violations.join(", ")}`);
    }
  }
  return problems;
}

export function runScenario(scenario, config = defaultConfig()) {
  const first = recommend(scenario.request, { config, store: scenario.store });
  const second = recommend(scenario.request, { config, store: scenario.store });
  const problems = [];
  if (first.statusCode !== 200) problems.push(`HTTP ${first.statusCode}`);
  if (JSON.stringify(first.body) !== JSON.stringify(second.body)) problems.push("not deterministic");
  problems.push(...integrityProblems(scenario.request, first.body, config));
  problems.push(...scenario.check(first.body));
  return { id: scenario.id, title: scenario.title, pass: problems.length === 0, problems, body: first.body };
}
