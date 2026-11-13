# Muse Learned Ranker & Personalization — Contribution Report

**Author:** Serge (Closette / Muse)  
**Branch:** `feature/muse-learned-ranker`  
**Models:** `muse-ranker-v1` (Phase 1), `muse-ranker-v1+linucb` (Phase 2)  
**Scope:** Closette-owned outfit ranking and per-user personalization, without replacing teammates’ candidate generation or hard rules.

---

## What I set out to do

Muse already recommended outfits from a user’s wardrobe, but the ranking step was a hand-tuned weighted average of a few content signals. That is solid engineering, and it was the right first ship. It is not, however, a model Closette owns in the machine-learning sense—and it does not learn from how a specific person reacts over time.

This work lands in two phases on one branch:

1. **Phase 1 — Learned outfit ranker.** Train and serve a Closette-owned MLP that re-scores legal outfits.
2. **Phase 2 — Personalized recommendations.** Fit per-user LinUCB from likes, saves, dismissals, dislikes, wears, and purchases, then blend it with the Phase 1 score.

I deliberately did **not** wrap an external chat API and call it “AI.” The contribution is inspectable models, exported weights, Node inference that matches the training contract, and offline numbers that show lift.

---

## How Muse works after Phase 1 and Phase 2

At a high level the request path teammates already know is unchanged:

1. Resolve the wardrobe (inline garments or catalog ids).
2. Normalize garments and partition out unavailable or context-ineligible pieces.
3. Generate candidate outfits from the existing structures.
4. Drop candidates that violate hard rules.
5. **Score and sort** the survivors — Phase 1 MLP, then Phase 2 LinUCB blend when the user has enough history.
6. Apply diversity selection and return the public recommendation envelope.

Responses advertise the method clearly:

| Field | Phase 1 cold user | Phase 2 warm user |
| --- | --- | --- |
| `ranking.method` | `learned_mlp_ranker` | `learned_mlp_plus_linucb` |
| `ranking.learned_model` | true | true |
| `ranking.personalization` | `linucb` | `linucb` |
| `ranking.personalization_applied` | false | true |
| `model_version` | `muse-ranker-v1` | `muse-ranker-v1+linucb` |

Set `ranking_policy: "baseline"` or `personalization: "baseline"` to roll either layer back without touching generation or rules.

---

## Phase 1 — How the learned ranker works

### Feature contract

Training and serving share one feature list (`ml/muse/features.py` ↔ `muse/ranking/learned.js`):

| Block | Features |
| --- | --- |
| Content | `occasion_match`, `style_match`, `garment_type_preference`, `color_preference`, `color_harmony`, `weather_suitability`, `context_layer` |
| Context | normalized temperature; occasion one-hots; season one-hots |
| Structure | `has_outerwear`, `n_items_norm` |

### Architecture

- **Model:** `sklearn.neural_network.MLPClassifier` with `StandardScaler`
- **Serving:** pure Node matrix–vector math in `learned.js`
- **Export:** JSON weights (`ranker-v1.json`) — no pickle, no Python in the API process

### Training

Synthetic wardrobes and preference labels bootstrap the model (`generate_synthetic.py` → `train_ranker.py`). Technologies: **Python 3**, **NumPy**, **scikit-learn**, plus the existing **Node Muse** service.

### Phase 1 evaluation

| Metric | Result |
| --- | --- |
| Test accuracy (pointwise) | **0.7905** |
| Test ROC-AUC | **0.8657** |
| Pairwise accuracy — learned | **0.8865** |
| Pairwise accuracy — hand baseline | **0.7250** |
| Lift vs hand baseline | **+0.1615** |

Artifacts: `ml/muse/reports/phase1_eval.json`, `ml/muse/weights/train_metrics.json`.

---

## Phase 2 — Personalized recommendations

### Why LinUCB

Muse’s arms are outfits that appear and disappear with the wardrobe, so a separate bandit per outfit would almost never repeat. The fit from `research/contextual_bandits.md` is a **shared linear LinUCB per user**: one design matrix `A` and vector `b`, features = the seven Muse content signals, arms = candidates that already survived hard rules.

Phase 2 wires the module that was previously tested but blocked on the request path.

### Feedback → reward

| Action | Reward | Notes |
| --- | --- | --- |
| `like`, `save`, `worn` | 1.0 | Explicit positive taste |
| `purchase` | 1.0 | Marketplace-ready strong positive |
| Specific `dislike` | 0.0 | Reason codes: color, formality, weather, style, comfort |
| `dismiss` / weak dislike | 0.25 | Soft negative; does not ban the outfit |

Optional fields for future marketplace checkout wiring:

- `source`: `wardrobe` | `marketplace`
- `product_ids`: catalog/marketplace ids

Events copy the recommendation’s content-feature snapshot so LinUCB can update without re-deriving garments.

### Blend with the Phase 1 ranker

```
base   = MLP score (or hand-weighted baseline)
final  = (1 - blend) * base + blend * sigmoid(θ · x)
```

Defaults: `personalization_blend = 0.28`, `personalization_min_events = 3`, `linucb_alpha = 0.8`. Exploration bonus stays available via `linucb_explore` but defaults off so rankings stay deterministic for tests and Nest.

Cold start: until enough feature-backed updates exist, Muse returns the Phase 1 score unchanged. The old heuristic feedback nudge remains available when LinUCB is off.

### Marketplace readiness

Phase 2 does not invent a marketplace catalog. It does make Muse ready for one:

- `purchase` is a first-class feedback action.
- `source` and `product_ids` travel with the stored event.
- Ranking still consumes Muse content features, so a future retrieval layer can attach products to outfits without rewriting LinUCB.

### Phase 2 evaluation vs Phase 1

Offline harness: `ml/muse/evaluate_personalization.py`  
Report: `ml/muse/reports/phase2_eval.json`

Synthetic users get a latent taste vector. Muse receives likes/saves/wears/purchases/dismissals/dislikes, fits LinUCB, then ranks holdout pairs by user taste.

| Metric | Result |
| --- | --- |
| Pairwise accuracy — Phase 1 MLP | **0.9570** |
| Pairwise accuracy — LinUCB only | **0.9766** |
| Pairwise accuracy — Phase 2 blend | **0.9740** |
| Lift vs Phase 1 | **+0.0169** |
| Near-tie accuracy — Phase 1 | **0.7778** |
| Near-tie accuracy — Phase 2 | **0.9383** |

Near-tie pairs (where the MLP scores are within 0.08) are where personalization matters most: Phase 2 recovers about **+16 points** of user-taste accuracy on those rows. Overall lift is smaller because the global MLP already agrees with many synthetic tastes; the blend still improves the hard calls without discarding Phase 1’s prior.

---

## Shared-project constraints

- Did **not** rewrite candidate generation, structures, or hard rules.
- Did **not** remove the baseline ranker or the ability to disable LinUCB.
- Tests that assert hand weights / heuristic feedback pin `rankingPolicy` and `personalization` to `baseline`.
- Nest’s HTTP shape stays compatible; clients see richer `ranking.*` metadata and optional marketplace fields on feedback.

---

## How this improves Muse for users

**Phase 1** replaces a fixed scoring recipe with a trained preference model Closette owns end to end—better ordering of legal outfits from day one.

**Phase 2** makes that ordering personal. After a few likes, saves, wears, dismissals, dislikes, or purchases, Muse tilts toward that person’s taste while keeping the global prior as ballast. Marketplace purchases can feed the same loop when Closette wires checkout.

Together: legal outfits from the team’s rules engine, ranked by a Closette-owned model, adapted to the individual without calling a third-party stylist API.

---

## Reproduce locally

```powershell
cd closette/ml/muse
python -m pip install -r requirements.txt
python generate_synthetic.py
python train_ranker.py
python evaluate.py
python evaluate_personalization.py

cd ../../muse
node --test
```

Confirm `muse/config/runtime.json` has `"ranking_policy": "learned"` and `"personalization": "linucb"`.

---

## Deliverables checklist

### Phase 1
- [x] Synthetic data generator and feature contract  
- [x] MLP training script and exported `ranker-v1` weights  
- [x] Offline evaluation vs hand-weighted baseline  
- [x] Node inference + Muse pipeline integration  
- [x] Tests for the learned path; baseline tests preserved  

### Phase 2
- [x] Per-user LinUCB fit from likes/saves/dismissals/dislikes/wears/purchases  
- [x] Blend into the learned ranker with cold-start safeguards  
- [x] Marketplace-ready `purchase` / `source` / `product_ids` on feedback  
- [x] Offline evaluation vs Phase 1 (`phase2_eval.json`)  
- [x] Updated humanized contribution report  

One branch, commits per phase, models we can defend in review, and Muse still looking like the system the team already knows—only smarter at ranking, and now personal.
