# Feedback contract

`POST /v1/outfits/feedback`

Muse copies garment ids and context from the stored recommendation. The client does not get to rewrite which clothes the event was about.

```json
{
  "recommendation_id": "rec-ca486f2362dd",
  "outfit_id": "outfit-1aa3347550c4",
  "action": "dislike",
  "user_id": "user-123",
  "timestamp": "2026-06-01T12:00:00.000Z",
  "reason": { "code": "color", "note": "too much navy" }
}
```

`user_id` and `timestamp` are optional. When `user_id` is sent it must match the recommendation. When `timestamp` is omitted, the server clock is stored.

`action` is one of `like`, `save`, `dislike`, `dismiss`, `worn`.

Stored record:

| Field | Meaning |
| --- | --- |
| `recommendation_id` | The id returned by `/v1/outfits/recommend`. |
| `outfit_id` | One outfit in that response. |
| `user_id` | Taken from the recommendation. |
| `garment_ids` | That outfit’s item ids, in role order. |
| `context` | Occasion, season, and weather stored with the recommendation. |
| `action` | The action above. |
| `reason` | `{ code, note }` or null. Unknown reasons stay null in effect: only `color`, `formality`, `weather`, `style`, and `comfort` count as a specific dislike. |
| `timestamp` | ISO-8601. |
| `model_version` | `muse-v1` from the recommendation. |

| HTTP | `error` | When |
| --- | --- | --- |
| 200 | | Stored. Body status is `stored`. |
| 400 | `invalid_feedback` | Missing ids, unknown action, or a bad timestamp. |
| 400 | `feedback_mismatch` | The outfit was not in that recommendation, or `user_id` disagrees. |
| 404 | `unknown_recommendation` | That recommendation was not issued by this store. |
| 500 | `feedback_store_unavailable` | The process has no store. |

The file store writes `recommendations.jsonl` and `feedback.jsonl`. Tests use an in-memory store. A dismissal is kept even when the reason is null. Ranking does not treat that row as a ban. See `ranking/FEATURES.md`.
