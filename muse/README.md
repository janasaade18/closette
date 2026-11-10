# Muse

Muse builds outfit recommendations from a Closette wardrobe. Version `muse-v1` is a deterministic baseline: slot outfits, hard rules, then a weighted ranker. It does not train a model.

The decision record is `reports/architecture_decision.md`. The HTTP contract is `api/CONTRACT.md`. The evaluation run is `reports/evaluation_report.md`.

Muse lives next to the Nest app and does not import `ml/garment`. It reads the same category ids and color names that pipeline already produces.

## Setup

Node.js 22 or newer. There is no package install.

```powershell
cd closette/muse
node --test
node evaluation/evaluate.js
node api/server.js --wardrobe evaluation/fixtures/demo_wardrobe.json --port 8787
```

The demo server keeps recommendations and feedback in memory. Pass `--data data` to append `recommendations.jsonl` and `feedback.jsonl`.

```powershell
curl -X POST http://127.0.0.1:8787/v1/outfits/recommend -H "content-type: application/json" --data-binary "@api/examples/request.json"
```

That request is the Nest-shaped example: wardrobe ids plus occasion, weather, and limit. The demo file maps `user-123` to four garments. At 22°C the jacket is outside its temperature range, so the response is the tee, jeans, and sneakers. See `api/examples/response.json`.

Send `wardrobe` inline when there is no catalog. See `api/examples/request.inline.json`.

## What a recommendation uses

Required: `user_id`, and either `wardrobe` or `wardrobe_item_ids`.

Optional: occasion, season, weather, limit, profile, and a per-request `preferences_override`.

Each garment needs an id. Category, subcategory, colors, pattern, seasons, temperature range, formality, style tags, and availability are all optional. Missing fields stay missing. A known subcategory such as `t-shirt` supplies the category `tops` from the taxonomy.

V1 outfits are top + bottom + footwear, or a one-piece plus footwear. A coat or blazer and one accessory are added only in the cases in `candidate_generation/STRUCTURES.md`. If those slots cannot be filled, Muse returns fewer outfits.

## Scores and reasons

`score` is a weighted average of the signals that had evidence, in [0, 1]. It is not a probability. Weights are in `ranking/weights.json`. Features are documented in `ranking/FEATURES.md`.

Hard rules are listed in `compatibility_rules/RULES.md` and configured in `compatibility_rules/config.json`. They do not encode color clashes or style taste.

`ranking.learned_model` is false. Feedback can nudge an outfit after three stored events. A dismissal without a specific reason is a weak signal. The LinUCB module in `personalization/` is tested and is not on the request path.

## Nest integration

Nest should resolve the user’s garments, including availability, and `POST /v1/outfits/recommend`. It can send the garment objects or item ids if Muse was started with a catalog. Nest should store nothing about the ranker except the JSON contract.

When the user likes, saves, dismisses, dislikes, or marks an outfit worn, Nest calls `POST /v1/outfits/feedback` with the `recommendation_id` and `outfit_id` from the response. Muse copies the garment ids and context from that recommendation.

Color and pattern fields should be copied from the garment-analysis response when they exist. Do not send a guessed color when analysis abstained.

## Tests

`node --test` covers rules, generation, ranking, feedback, the HTTP server, LinUCB’s matrix update, and the manual scenarios. `node evaluation/evaluate.js` rewrites `reports/evaluation_report.md` and the demo response example.
