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
    score_semantics: "mlp_preference_score_in_0_1_with_optional_linucb",
    personalization: "linucb",
    learned_model: true,
    feedback_actions: ["like", "save", "dislike", "dismiss", "worn", "purchase"],
  };
}
