# Baseline features

Weights live in `ranking/weights.json`. They are renormalized over the features that have evidence. A feature with no evidence is left out. It is not replaced with a neutral guess, except when every feature is missing: the score is then `uninformed_score` (0.5).

The score is in [0, 1]. It is not a probability. `score_semantics` on the response is `weighted_average_of_active_features_not_a_probability`.

| Feature | Weight | Active when | Value |
| --- | --- | --- | --- |
| `occasion_match` | 0.27 | An occasion was requested and at least one garment has formality or a matching style tag. | Mean formality affinity, with a style-tag hit counted as 1. Known occasions use the table in `ranking/affinity.js`. |
| `style_match` | 0.16 | The profile lists preferred styles and at least one garment has style tags. | 1 when a tag matches, 0.25 when tags exist and none match. |
| `garment_type_preference` | 0.09 | The profile lists preferred types and garments have a category or subcategory. | Share of pieces whose subcategory or category is listed. |
| `color_preference` | 0.14 | The profile has favorite or disliked colors and at least one primary color is known. | 1 for a favorite primary, 0 for a disliked primary, 0.7 when only a secondary color is a favorite. |
| `color_harmony` | 0.09 | At least two primary colors are known. | Mean of pairs. Same color 0.85. A neutral with anything 0.9. Same family 0.8. Otherwise 0.55. Neutrals are black, white, off-white, grey, charcoal, beige, cream, tan, brown, and navy. 0.55 is “no evidence they are easy,” not a clash. |
| `weather_suitability` | 0.16 | The request has temperature, condition, or season, and a garment has a range, season list, or unsuitable condition. | 1 when the known fields agree with the request. |
| `context_layer` | 0.09 | The day is cool (under 18°C, or fall/winter when no temperature was sent), or the occasion is formal or work. | 1 when the outfit includes outerwear, 0.35 when it does not. |

Feedback is not inside that average. After at least 3 stored events for the user, an outfit that shares garments with those events gets:

`score += 0.06 * (sigmoid(raw) - 0.5)`

`raw` sums like and save as +1, worn as +1.5, a dislike with reason code `color`, `formality`, `weather`, `style`, or `comfort` as -1, and a dismissal or a dislike without one of those codes as -0.15. Each event is scaled by how much of that event’s garment list appears in the outfit. Fewer than 3 events leaves the score unchanged. The response still sets `learned_model` to false.

Reasons are attached when an active, positively weighted feature is at least 0.7, or 0.85 for color harmony. Feedback text is added only when the history contains a like, save, or worn and the sigmoid value is at least 0.7. Otherwise the outfit gets “Built from pieces in your wardrobe that passed the outfit rules.”

Returned order prefers a later outfit when it shares fewer than two core garments with one already chosen (`diversity_max_shared_core` in `config/runtime.json`). The published score stays the rank score. If that pass would return fewer outfits than exist, the remaining higher-scoring outfits are appended.
