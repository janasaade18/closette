"""Offline evaluation: learned ranker vs Muse hand-weighted baseline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from features import FEATURE_NAMES

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
WEIGHTS = ROOT / "weights"
REPORTS = ROOT / "reports"


def load_model(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def activate(values: np.ndarray, name: str) -> np.ndarray:
    if name == "relu":
        return np.maximum(values, 0.0)
    if name == "logistic":
        return 1.0 / (1.0 + np.exp(-values))
    raise ValueError(f"unknown activation {name}")


def predict_proba(model: dict, x: np.ndarray) -> np.ndarray:
    mean = np.asarray(model["scaler"]["mean"], dtype=np.float64)
    scale = np.asarray(model["scaler"]["scale"], dtype=np.float64)
    hidden = (x - mean) / scale
    for layer in model["layers"]:
        weight = np.asarray(layer["weight"], dtype=np.float64)
        bias = np.asarray(layer["bias"], dtype=np.float64)
        hidden = activate(hidden @ weight + bias, layer["activation"])
    return hidden.reshape(-1)


def pairwise_accuracy(pairs: list[dict], score_fn) -> float:
    if not pairs:
        return 0.0
    wins = 0
    for row in pairs:
        winner = score_fn(np.asarray(row["winner_vector"], dtype=np.float64))
        loser = score_fn(np.asarray(row["loser_vector"], dtype=np.float64))
        if winner > loser:
            wins += 1
    return wins / len(pairs)


def baseline_from_vector(vector: np.ndarray) -> float:
    # First 7 dims are content features with missing already filled as 0.5.
    weights = np.asarray([0.27, 0.16, 0.09, 0.14, 0.09, 0.16, 0.09], dtype=np.float64)
    content = vector[:7]
    return float(np.dot(content, weights) / weights.sum())


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Muse learned ranker")
    parser.add_argument("--pairs", type=Path, default=DATA / "pairs.jsonl")
    parser.add_argument("--model", type=Path, default=WEIGHTS / "ranker-v1.json")
    parser.add_argument("--out", type=Path, default=REPORTS / "phase1_eval.json")
    args = parser.parse_args()

    if not args.model.exists():
        raise SystemExit(f"Missing {args.model}. Run train_ranker.py first.")
    if not args.pairs.exists():
        raise SystemExit(f"Missing {args.pairs}. Run generate_synthetic.py first.")

    model = load_model(args.model)
    if model["feature_names"] != FEATURE_NAMES:
        raise SystemExit("Model feature_names do not match features.py")

    pairs = [json.loads(line) for line in args.pairs.read_text(encoding="utf-8").splitlines() if line.strip()]
    # Hold out last 20% of pairs as eval slice (generation is seeded).
    split = max(1, int(len(pairs) * 0.8))
    eval_pairs = pairs[split:]

    learned_acc = pairwise_accuracy(eval_pairs, lambda v: float(predict_proba(model, v.reshape(1, -1))[0]))
    baseline_acc = pairwise_accuracy(eval_pairs, baseline_from_vector)

    report = {
        "model_version": model["model_version"],
        "n_eval_pairs": len(eval_pairs),
        "pairwise_accuracy_learned": round(learned_acc, 4),
        "pairwise_accuracy_baseline": round(baseline_acc, 4),
        "lift": round(learned_acc - baseline_acc, 4),
        "train_metrics": model.get("metrics", {}),
        "notes": [
            "Pairwise accuracy: fraction of preference pairs where the preferred outfit scores higher.",
            "Baseline uses Muse's published hand weights on the seven content features.",
            "Learned model is the exported MLP from train_ranker.py.",
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
