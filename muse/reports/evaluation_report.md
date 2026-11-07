# Muse v1 evaluation

The baseline is a fixed configuration. The same request returns the same outfits, scores, and reasons. This run does not measure a learned preference model. `learned_model` is false in every scenario.

Checks on every scenario: recommended ids belong to the supplied wardrobe, no garment is repeated inside an outfit, hard rules accept every recommended garment, each outfit has a score in [0, 1] and at least one reason, and a second run matches the first.

| Scenario | Result | Status | Outfits | Mean Jaccard |
| --- | --- | --- | --- | --- |
| New user with no preference history | pass | ok | 1 | n/a |
| Small wardrobe with one possible outfit | pass | ok | 1 | n/a |
| Missing color and pattern metadata | pass | ok | 1 | n/a |
| Formal occasion with mostly casual garments | pass | ok | 1 | n/a |
| Weather data unavailable | pass | ok | 1 | n/a |
| The same color is liked and disliked | pass | ok | 1 | n/a |
| No outfit survives the hard rules | pass | insufficient_candidates | 0 | n/a |
| Several outfits from a wider wardrobe | pass | ok | 3 | 0.233 |
| Empty wardrobe | pass | empty_wardrobe | 0 | n/a |

## Notes

- Mean Jaccard is the average garment overlap between returned outfits. `n/a` means fewer than two outfits were returned. The wider-wardrobe scenario checks that the three returned outfits do not all reuse one top.
- A formal request drops garments whose formality is casual. Garments with no formality stay eligible. Muse does not invent that missing formality.
- Weather reasons appear only when the request has weather or season and at least one garment has a range, season, or unsuitable condition.
- Conflicting favorite and disliked colors keep the dislike and return a `conflicting_color_preference` warning.
- Empty wardrobes and rule-blocked wardrobes return lists, not invented garments. HTTP status stays 200. The body status is `empty_wardrobe` or `insufficient_candidates`.
- Feedback was not part of these scenarios. Separate unit tests check that three likes can change order and that three dismissals without a reason do not delete an outfit. That adjustment is not a trained model.
