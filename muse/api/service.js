import { recommend } from "../pipeline.js";
import { recordFeedback } from "../feedback/store.js";
import { API_VERSION, MODEL_VERSION } from "../schemas/constants.js";

export function handleRecommend(body, deps) {
  return recommend(body, deps);
}

export function handleFeedback(body, deps) {
  return recordFeedback(body, deps);
}

export function contractBody() {
  return {
    api_version: API_VERSION,
    model_version: MODEL_VERSION,
    recommend: "POST /v1/outfits/recommend",
    feedback: "POST /v1/outfits/feedback",
    score_semantics: "weighted_average_of_active_features_not_a_probability",
    personalization: "baseline",
    learned_model: false,
  };
}
