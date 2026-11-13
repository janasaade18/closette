"""Train the Muse outfit ranker and export JSON weights for Node inference."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from features import FEATURE_NAMES

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
WEIGHTS = ROOT / "weights"


def load_examples(path: Path) -> tuple[np.ndarray, np.ndarray]:
    xs: list[list[float]] = []
    ys: list[int] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            xs.append(row["feature_vector"])
            ys.append(int(row["label"]))
    return np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.int64)


def export_mlp(pipeline: Pipeline, metrics: dict, path: Path) -> None:
    scaler: StandardScaler = pipeline.named_steps["scaler"]
    clf: MLPClassifier = pipeline.named_steps["model"]
    payload = {
        "model_version": "muse-ranker-v1",
        "type": "mlp_classifier",
        "framework": "scikit-learn",
        "feature_names": FEATURE_NAMES,
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "layers": [],
        "metrics": metrics,
    }
    for index, (weights, bias) in enumerate(zip(clf.coefs_, clf.intercepts_)):
        activation = "relu"
        if index == len(clf.coefs_) - 1:
            activation = "logistic"
        payload["layers"].append(
            {
                "activation": activation,
                "weight": [list(map(float, row)) for row in weights],
                "bias": list(map(float, bias)),
            }
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Muse learned ranker")
    parser.add_argument("--examples", type=Path, default=DATA / "examples.jsonl")
    parser.add_argument("--out", type=Path, default=WEIGHTS / "ranker-v1.json")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not args.examples.exists():
        raise SystemExit(f"Missing {args.examples}. Run generate_synthetic.py first.")

    x, y = load_examples(args.examples)
    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.2,
        random_state=args.seed,
        stratify=y,
    )

    pipeline = Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            (
                "model",
                MLPClassifier(
                    hidden_layer_sizes=(32, 16),
                    activation="relu",
                    solver="adam",
                    max_iter=400,
                    random_state=args.seed,
                    early_stopping=True,
                    validation_fraction=0.15,
                ),
            ),
        ]
    )
    pipeline.fit(x_train, y_train)

    proba = pipeline.predict_proba(x_test)[:, 1]
    pred = (proba >= 0.5).astype(int)
    metrics = {
        "n_train": int(len(x_train)),
        "n_test": int(len(x_test)),
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
        "positive_rate_test": round(float(y_test.mean()), 4),
    }
    export_mlp(pipeline, metrics, args.out)
    (WEIGHTS / "train_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps({"weights": str(args.out), **metrics}, indent=2))


if __name__ == "__main__":
    main()
