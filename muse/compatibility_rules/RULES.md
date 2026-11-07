# Hard rules

Config: `compatibility_rules/config.json`. These rules remove outfits before ranking. Style taste, color harmony, and feedback are not rules.

A rule runs only when both the garment and the request contain the field it reads. A missing formality, color, season, temperature range, or availability is not treated as a clash.

| Rule id | Removes the garment or outfit when |
| --- | --- |
| `missing_category` | No category, and the subcategory is not in the Closette taxonomy. A known subcategory such as `t-shirt` fills `tops`. That lookup is the taxonomy, not a guess from a photo. |
| `unknown_category` | The category is not one of tops, bottoms, one-piece, outerwear, footwear, accessories. |
| `category_subcategory_mismatch` | Both ids are in the taxonomy and they disagree. |
| `unavailable` | Availability is `unavailable` or `laundry` (`in laundry` counts as laundry). `clean`, `available`, and any other status stay eligible. |
| `avoid_garment` | The id is in `avoid_garment_ids`. |
| `avoid_category` | The category is in `avoid_categories`. |
| `avoid_subcategory` | The subcategory is in `avoid_subcategories`. |
| `disliked_color` | The primary color is in `disliked_colors`. A missing primary color is kept. A disliked secondary color is not a hard removal. |
| `occasion_formality` | The occasion is a known one and the garment’s formality is on that occasion’s reject list. Formal rejects casual and athletic. Casual rejects formal. Work and smart-casual reject athletic. An unknown occasion string, or a garment with no formality, skips this rule. |
| `temperature_range` | `temperature_c` is outside a bound the garment actually has. |
| `season` | The request season and the garment’s season list are both known and disjoint. `autumn` is read as `fall`. |
| `unsuitable_condition` | The weather condition is listed on that garment, for example `unsuitable_conditions: ["rain"]`. Sandals are not assumed to fail in rain. |
| `duplicate_garment` | The same id appears twice in one outfit. Generation also avoids this. |
| `explicit_incompatibility` | A garment’s `incompatible_with` lists another item’s id, subcategory, or category. |

`color_clash_is_hard_rule`, `style_preference_is_hard_rule`, and `dismissal_is_hard_rule` are false. Two patterns, or red with green, stay eligible. Ranking may describe colors that are easy to wear together. It does not call the other pairs a clash.

If a color is both a favorite and a dislike, the dislike wins and the response includes `conflicting_color_preference`.

Free-text `explicit_preferences` are echoed in a warning and are not parsed into rules. Structured fields are the contract.
