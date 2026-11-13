import { recommend } from "../pipeline.js";
import { recordFeedback } from "../feedback/store.js";
import { planTravel } from "../travel/pack.js";
import { API_VERSION, MODEL_VERSION } from "../schemas/constants.js";

export function handleRecommend(body, deps) {
  return recommend(body, deps);
}

export function handleFeedback(body, deps) {
  return recordFeedback(body, deps);
}

export function handleTravelPack(body, deps) {
  return planTravel(body, deps);
}

export function contractBody() {
  return {
    api_version: API_VERSION,
    model_version: MODEL_VERSION,
    recommend: "POST /v1/outfits/recommend",
    feedback: "POST /v1/outfits/feedback",
    travel_pack: "POST /v1/travel/pack",
    score_semantics: "mlp_preference_score_in_0_1_with_optional_linucb",
    personalization: "linucb",
    learned_model: true,
    marketplace: "opt_in_via_request_or_runtime",
    travel: "opt_in_via_/v1/travel/pack",
    feedback_actions: ["like", "save", "dislike", "dismiss", "worn", "purchase"],
  };
}
