# Muse learned ranker (Phase 1)

This package trains a **Closette-owned** outfit ranking model and exports weights that the Node Muse service can load.

It does **not** replace Muse’s candidate generation or hard rules. Those stay in `muse/`. The learned model only re-scores outfits that already passed the rules.

## Layout

| Path | Role |
| --- | --- |
| `generate_synthetic.py` | Synthetic wardrobes, contexts, outfits, and preference labels |
| `features.py` | Shared feature contract with Node (`muse/ranking/learned.js`) |
| `train_ranker.py` | Train an MLP ranker and write `weights/ranker-v1.json` |
| `evaluate.py` | Offline metrics vs the hand-weighted baseline |
| `evaluate_personalization.py` | Phase 2: MLP vs MLP+LinUCB on simulated user feedback |
| `evaluate_marketplace.py` | Phase 3: marketplace constraints + complement lift (no RAG/Qwen) |
| `evaluate_travel.py` | Phase 4: multi-day rotation + luggage packing heuristics |
| `requirements.txt` | NumPy + scikit-learn only |

## Quick start

```powershell
cd closette/ml/muse
python -m pip install -r requirements.txt
python generate_synthetic.py
python train_ranker.py
python evaluate.py
python evaluate_personalization.py
python evaluate_marketplace.py
python evaluate_travel.py
```

Then start Muse as usual. With `ranking_policy: "learned"` and `personalization: "linucb"`, recommendations use `muse-ranker-v1` and personalize after enough feedback. Send `marketplace.enabled: true` for Phase 3. Use `POST /v1/travel/pack` for Phase 4 multi-day packing.
