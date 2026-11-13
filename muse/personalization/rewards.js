/**
 * Map Muse feedback actions to LinUCB rewards in [0, 1].
 * Purchase is a strong positive for future marketplace checkout events.
 */
import { SPECIFIC_DISLIKE_REASONS } from "../schemas/constants.js";

export function rewardForFeedback(action, reason = null) {
  if (action === "like" || action === "save") return 1;
  if (action === "worn") return 1;
  if (action === "purchase") return 1;
  if (action === "dislike") {
    const code = reason?.code ?? null;
    if (code && SPECIFIC_DISLIKE_REASONS.has(code)) return 0;
    return 0.25;
  }
  if (action === "dismiss") return 0.25;
  return 0.5;
}
