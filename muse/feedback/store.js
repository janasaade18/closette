import fs from "node:fs";
import path from "node:path";
import { validateFeedbackRequest } from "../schemas/validate.js";
import { API_VERSION, MODEL_VERSION } from "../schemas/constants.js";

export class MemoryMuseStore {
  constructor() {
    this.events = [];
    this.recs = new Map();
  }

  saveRecommendation(record) {
    if (!this.recs.has(record.recommendation_id)) this.recs.set(record.recommendation_id, record);
  }

  getRecommendation(id) {
    return this.recs.get(id) ?? null;
  }

  addFeedback(event) {
    this.events.push(event);
    return event;
  }

  eventsForUser(userId) {
    return this.events.filter((event) => event.user_id === userId);
  }
}

export class FileMuseStore extends MemoryMuseStore {
  constructor(dir) {
    super();
    this.feedbackPath = path.join(dir, "feedback.jsonl");
    this.recsPath = path.join(dir, "recommendations.jsonl");
    fs.mkdirSync(dir, { recursive: true });
    this.#load(this.feedbackPath, (row) => this.events.push(row));
    this.#load(this.recsPath, (row) => this.recs.set(row.recommendation_id, row));
  }

  #load(file, onRow) {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (line.trim()) onRow(JSON.parse(line));
    }
  }

  saveRecommendation(record) {
    if (this.recs.has(record.recommendation_id)) return;
    this.recs.set(record.recommendation_id, record);
    fs.appendFileSync(this.recsPath, `${JSON.stringify(record)}\n`);
  }

  addFeedback(event) {
    this.events.push(event);
    fs.appendFileSync(this.feedbackPath, `${JSON.stringify(event)}\n`);
    return event;
  }
}

export function recordFeedback(body, deps) {
  const parsed = validateFeedbackRequest(body);
  if (parsed.error) return parsed.error;
  const store = deps.store;
  if (!store) {
    return {
      statusCode: 500,
      body: {
        api_version: API_VERSION,
        model_version: MODEL_VERSION,
        status: "error",
        error: "feedback_store_unavailable",
        message: "No feedback store is configured.",
      },
    };
  }
  const value = parsed.value;
  const recommendation = store.getRecommendation(value.recommendationId);
  if (!recommendation) {
    return {
      statusCode: 404,
      body: {
        api_version: API_VERSION,
        model_version: MODEL_VERSION,
        status: "error",
        error: "unknown_recommendation",
        message: "Feedback must refer to a recommendation Muse already returned.",
      },
    };
  }
  const outfit = recommendation.shown.find((entry) => entry.outfit_id === value.outfitId);
  if (!outfit) {
    return {
      statusCode: 400,
      body: {
        api_version: API_VERSION,
        model_version: MODEL_VERSION,
        status: "error",
        error: "feedback_mismatch",
        message: "outfit_id is not part of that recommendation.",
      },
    };
  }
  if (value.userId && value.userId !== recommendation.user_id) {
    return {
      statusCode: 400,
      body: {
        api_version: API_VERSION,
        model_version: MODEL_VERSION,
        status: "error",
        error: "feedback_mismatch",
        message: "user_id does not match the recommendation.",
      },
    };
  }
  const event = {
    recommendation_id: recommendation.recommendation_id,
    outfit_id: outfit.outfit_id,
    user_id: recommendation.user_id,
    garment_ids: [...outfit.garment_ids],
    context: recommendation.context,
    action: value.action,
    reason: value.reason,
    timestamp: value.timestamp ?? (deps.now ? deps.now() : new Date().toISOString()),
    model_version: recommendation.model_version,
  };
  store.addFeedback(event);
  return {
    statusCode: 200,
    body: {
      api_version: API_VERSION,
      model_version: MODEL_VERSION,
      status: "stored",
      feedback: event,
    },
  };
}
