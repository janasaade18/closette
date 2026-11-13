# Personalization (Phase 2)

Muse fits a **per-user shared LinUCB** from logged feedback and blends it with the Phase 1 learned ranker (or the hand-weighted baseline).

## Request path

- Runtime default: `personalization: "linucb"` in `config/runtime.json`.
- Cold users (fewer than `personalization_min_events` feature-backed updates) keep Phase 1 scores unchanged.
- Ready users get `ranking.method = learned_mlp_plus_linucb` and `model_version` like `muse-ranker-v1+linucb`.
- Set `personalization: "baseline"` (config or request) to disable LinUCB.

## Feedback signals

Rewards come from `like`, `save`, `worn`, `purchase` (positive), specific `dislike` (zero), and `dismiss` / weak dislike (small negative). See `rewards.js`.

`purchase` plus optional `source: "marketplace"` and `product_ids` are reserved for future marketplace checkout events. Ranking still keys off the recommendation snapshot’s content features.

## Modules

| File | Role |
| --- | --- |
| `linucb.js` | Shared linear LinUCB (one `A`, `b` per user) |
| `fit.js` | Fit from store events; blend with base score |
| `features.js` | Map Muse content features → LinUCB vector |
| `rewards.js` | Action → reward in `[0, 1]` |

Candidate generation and hard rules are unchanged. Read `research/contextual_bandits.md` for the modeling rationale.
