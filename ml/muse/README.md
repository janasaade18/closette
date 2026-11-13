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
| `requirements.txt` | NumPy + scikit-learn only |

## Quick start

```powershell
cd closette/ml/muse
python -m pip install -r requirements.txt
python generate_synthetic.py
python train_ranker.py
python evaluate.py
```

Then start Muse as usual. With `ranking_policy: "learned"` in `muse/config/runtime.json`, recommendations use `muse-ranker-v1`.
