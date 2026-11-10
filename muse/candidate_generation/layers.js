/**
 * When an optional outer layer is worth generating.
 * Temperature, when present, decides cool-weather layering.
 * A formal or work occasion can still add a tailored outer layer.
 */
export function suggestsCoolLayer(context, config) {
  const temp = context.weather?.temperature_c;
  if (typeof temp === "number") return temp < config.coldTempC;
  return Boolean(context.season && config.coolSeasons.includes(context.season));
}

export function tailoredOuterwear(item, context) {
  if (context.occasion !== "formal" && context.occasion !== "work") return false;
  return item.formality === "formal" || item.formality === "work" || item.formality === "smart-casual";
}

export function layerContextActive(context, config) {
  return suggestsCoolLayer(context, config) || context.occasion === "formal" || context.occasion === "work";
}
