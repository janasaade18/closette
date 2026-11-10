# Muse API v1

Base path `/v1`. `api_version` is `v1`. `model_version` is `muse-v1`.

The mobile app and the Nest process should depend on this document, not on the ranker file layout.

## `POST /v1/outfits/recommend`

Required:

- `user_id` string
- `wardrobe` or `wardrobe_item_ids` (one of them)

`wardrobe` is the standalone contract: Muse can run with no database. `wardrobe_item_ids` is the Nest contract. The server resolves ids with a catalog loaded from `MUSE_WARDROBE_FILE` or `--wardrobe`. Ids without a catalog return HTTP 422 `wardrobe_unavailable`.

Optional:

| Field | Notes |
| --- | --- |
| `occasion` | `casual`, `smart-casual`, `work`, `formal`, or any other label up to 80 characters. Unknown labels do not use the formality reject table. |
| `season` | `spring`, `summer`, `fall`, `winter`. `autumn` is accepted as `fall`. |
| `weather.temperature_c` | Number from -80 to 60. |
| `weather.condition` | String, matched only against a garment’s `unsuitable_conditions`. |
| `limit` | Integer 1–10. Default 3. |
| `profile` | Preferred styles, favorite and disliked colors, preferred garment types, avoid lists, and free-text `explicit_preferences`. |
| `preferences_override` | Same fields as `profile`. When a field is present here it replaces the profile field for this request. |

A garment may omit category, colors, pattern, season, temperature, formality, style tags, and availability. Muse does not fill those in, except that a known subcategory supplies its taxonomy category. Pattern is stored and is not a rule.

Example request: `api/examples/request.json`. Example response from the demo wardrobe at 22°C: `api/examples/response.json`. The jacket is excluded because 22°C is above its declared maximum of 18°C. The score `0.9827` is the weighted feature average for that input. It is not a probability.

### Success body

`status` is `ok`, `empty_wardrobe`, or `insufficient_candidates`. HTTP status is 200 for all three.

Each recommendation has `outfit_id`, `items` (wardrobe ids in role order), `roles`, `score`, `reasons`, `reason_codes`, `signals_used`, and `model_version`.

`ranking.learned_model` is false. `ranking.feedback_applied` is true only when the three-event adjustment moved at least one returned outfit.

`excluded_items` lists ids removed by hard rules. `warnings` can include `unknown_wardrobe_items`, `unknown_user_wardrobe`, `unknown_fields`, `conflicting_color_preference`, and `explicit_preferences_not_interpreted`.

### Errors

| HTTP | `error` | When |
| --- | --- | --- |
| 400 | `invalid_request` | Missing user, bad limit, bad types, duplicate garment ids, bad season or temperature. `fields` names the problem. |
| 400 | `invalid_json` | Body is not JSON. |
| 400 | `personalization_not_available` | The client asks for LinUCB. |
| 404 | `not_found` | Unknown path. |
| 405 | `method_not_allowed` | Recommend or feedback called without POST. |
| 413 | `payload_too_large` | Body over 1 MB. |
| 422 | `wardrobe_unavailable` | Item ids were sent and this process has no catalog. |
| 500 | `internal_error` | Unexpected failure. |

Sample error: `api/examples/error.json`.

## `POST /v1/outfits/feedback`

See `feedback/CONTRACT.md`. Example: `api/examples/feedback.json`.

## `GET /health`

`{ "ok": true, "api_version": "v1", "model_version": "muse-v1", "personalization": "baseline" }`

## `GET /v1/outfits/contract`

Short pointer to this version and the two POST paths.

## Recommendation ids

`outfit_id` is a hash of the sorted garment ids. `recommendation_id` is a hash of the user, context, ordered outfit ids, and `muse-v1`. The same input returns the same ids. The response does not include a timestamp, so retries match.
