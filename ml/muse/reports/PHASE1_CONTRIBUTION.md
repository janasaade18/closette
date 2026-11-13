# Muse Learned Outfit Ranker — Phase 1 Contribution Report

**Author:** Serge (Closette / Muse)  
**Branch:** `feature/muse-learned-ranker`  
**Model version:** `muse-ranker-v1`  
**Scope:** Closette-owned outfit ranking for Muse, without replacing teammates’ candidate generation or hard rules.

---

## What I set out to do

Muse already recommended outfits from a user’s wardrobe, but the ranking step was a hand-tuned weighted average of a few content signals. That is solid engineering, and it was the right first ship. It is not, however, a model Closette owns in the machine-learning sense.

Phase 1 turns that ranking step into a **learned preference model** that we train, evaluate, version, and serve ourselves. The rest of Muse stays where my teammates left it: slot structures, beam search, laundry/availability filters, and hard compatibility rules still decide *which* outfits are legal. The learned ranker only decides *which legal outfits float to the top*.

I deliberately did **not** wrap an external chat API and call it “AI.” The contribution is a small, inspectable classifier with exported weights, Node inference that matches the Python training contract, and numbers that show it beats the previous baseline on held-out preference pairs.

---

## How Muse works after Phase 1

At a high level the request path is unchanged:

1. Resolve the wardrobe (inline garments or catalog ids).
2. Normalize garments and partition out unavailable or context-ineligible pieces.
3. Generate candidate outfits from the existing structures (top/bottom/shoes, one-piece + shoes, optional layer/accessory).
4. Drop candidates that violate hard rules.
5. **Score and sort** the survivors — this is where Phase 1 lands.
6. Apply diversity selection and return the public recommendation envelope.

When `ranking_policy` is `learned` (the new default in `muse/config/runtime.json`), step 5 loads `ml/muse/weights/ranker-v1.json` and scores each outfit with a multilayer perceptron. If the weights file is missing or the policy is set back to `baseline`, Muse falls through to the original hand weights so the service stays operable for teammates and for regression tests.

Responses now advertise the method clearly:

- `ranking.method`: `learned_mlp_ranker` or `baseline_weighted_features`
- `ranking.learned_model`: boolean
- `model_version`: `muse-ranker-v1` when the MLP is active
- `score_semantics`: `mlp_preference_score_in_0_1` on the learned path

---

## How the model works

### Feature contract

Training and serving share one feature list (`ml/muse/features.py` ↔ `muse/ranking/learned.js`):

| Block | Features |
| --- | --- |
| Content (from Muse’s existing signals) | `occasion_match`, `style_match`, `garment_type_preference`, `color_preference`, `color_harmony`, `weather_suitability`, `context_layer` |
| Context | normalized temperature; occasion one-hots; season one-hots |
| Structure | `has_outerwear`, `n_items_norm` |

Missing content signals are filled with `0.5` so the vector length stays fixed. That is intentional: the Node path reuses Muse’s feature extractors instead of inventing a parallel taxonomy.

### Architecture

- **Model:** `sklearn.neural_network.MLPClassifier`
- **Hidden layers:** two small ReLU layers (training script defaults)
- **Output:** logistic preference score in `[0, 1]`
- **Preprocessing:** `StandardScaler` fitted on the training matrix and exported with the weights
- **Serving:** pure Node matrix–vector math in `learned.js` — no Python runtime in the Muse API process

The export format is JSON: scaler mean/scale, layer coefficients and intercepts, activation names, feature names, and `model_version`. That keeps the artifact reviewable in git and loadable without pickles.

---

## How it was trained

### Synthetic data

Real Closette preference logs are not yet large enough to train a stable ranker, so Phase 1 starts with a **synthetic preference generator** (`generate_synthetic.py`):

- Builds product catalogs and multi-item wardrobes consistent with Muse’s garment schema.
- Samples occasions, seasons, and weather.
- Forms legal-looking outfits and scores them with a latent preference function that rewards occasion fit, color harmony, weather sense, and layering when it is cold or formal.
- Emits labeled examples (`examples.jsonl`) and pairwise preference pairs (`pairs.jsonl`) for ranking evaluation.

Synthetic data is a deliberate bootstrap. The feature contract and export path are real; later phases can swap the generator for anonymized production feedback without rewriting Muse.

### Training loop

`train_ranker.py`:

1. Loads the example matrix and binary preference labels.
2. Holds out a stratified test split.
3. Fits the scaler + MLP.
4. Writes `weights/ranker-v1.json` and `weights/train_metrics.json`.

Technologies used on the Python side: **Python 3**, **NumPy**, **scikit-learn**. On the product side: the existing **Node Muse** service, unchanged Nest/mobile contracts except for the richer ranking metadata.

---

## Evaluation results

Offline evaluation (`evaluate.py`) compares the learned scorer to Muse’s published hand weights on held-out preference pairs.

| Metric | Result |
| --- | --- |
| Test accuracy (pointwise) | **0.7905** |
| Test ROC-AUC | **0.8657** |
| Pairwise accuracy — learned | **0.8865** |
| Pairwise accuracy — baseline | **0.7250** |
| Lift (learned − baseline) | **+0.1615** |
| Train / test example counts | 4563 / 1141 |
| Eval preference pairs | 520 |

Pairwise accuracy is the metric that matches the product: given two outfits for the same context, how often does the model put the preferred one first? A lift of about sixteen points over the hand-tuned baseline is the Phase 1 proof that learning the ranking surface is worth shipping.

Artifacts live in `ml/muse/reports/phase1_eval.json` and `ml/muse/weights/train_metrics.json`.

---

## Integration into Muse (shared-project constraints)

I treated the Muse package as shared infrastructure:

- **Did not** rewrite candidate generation, structures, or hard rules.
- **Did not** remove the baseline path; tests that assert weight and feedback behavior pin `rankingPolicy: "baseline"`.
- **Did** add a thin inference module, plumb an optional `learnedModel` through `scoreOutfit` / `rankOutfits`, and load weights inside `recommend()` when policy asks for it.
- **Did** keep Nest’s HTTP contract: same endpoints, same wardrobe payloads; clients see a new `model_version` and ranking flags rather than a breaking shape change.

That means teammates can keep iterating on rules and garment analysis while this ranker improves the ordering of valid outfits.

---

## How this improves Muse for users

Before Phase 1, every eligible outfit was ordered by a fixed recipe of feature weights. That recipe is transparent, but it cannot capture non-linear interactions (for example, cold weather plus formal occasion plus outerwear) without more hand tuning.

After Phase 1:

- Recommendations are ordered by a **trained preference model** Closette owns end to end.
- The score is still grounded in Muse’s own features, so explanations remain tied to occasion, weather, color, and layering.
- We have an offline evaluation harness to reject bad retrainings before they touch the API.
- The default runtime policy uses the learned model, with a one-line rollback to baseline if needed.

This is the foundation for later phases (online feedback fine-tuning, marketplace retrieval, richer conversational styling) without pretending those systems already exist.

---

## Reproduce locally

```powershell
cd closette/ml/muse
python -m pip install -r requirements.txt
python generate_synthetic.py
python train_ranker.py
python evaluate.py

cd ../../muse
node --test
```

Confirm `muse/config/runtime.json` has `"ranking_policy": "learned"`, then exercise `POST /v1/outfits/recommend` as before.

---

## Phase 1 deliverables checklist

- [x] Synthetic data generator and feature contract  
- [x] MLP training script and exported `ranker-v1` weights  
- [x] Offline evaluation vs baseline with reported lift  
- [x] Node inference + Muse pipeline integration  
- [x] Tests for the learned path; baseline tests preserved  
- [x] This contribution report  

Phase 1 stops here on purpose: one branch, clear commits per phase, a model we can defend in review, and Muse still looking like the system the team already knows — only smarter at ranking.
