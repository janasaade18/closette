"""Phase 2 offline eval: Phase 1 MLP vs MLP + per-user LinUCB.

Simulates users with latent taste over the seven content features, generates
feedback (likes/dislikes/saves/dismissals/purchases), fits LinUCB, and compares
pairwise preference accuracy against the Phase 1 learned scorer alone.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

from features import FEATURE_NAMES

ROOT = Path(__file__).resolve().parent
WEIGHTS = ROOT / "weights"
REPORTS = ROOT / "reports"
DATA = ROOT / "data"


def load_model(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def activate(values: np.ndarray, name: str) -> np.ndarray:
    if name == "relu":
        return np.maximum(values, 0.0)
    if name == "logistic":
        return 1.0 / (1.0 + np.exp(-values))
    raise ValueError(f"unknown activation {name}")


def predict_proba(model: dict, x: np.ndarray) -> float:
    mean = np.asarray(model["scaler"]["mean"], dtype=np.float64)
    scale = np.asarray(model["scaler"]["scale"], dtype=np.float64)
    hidden = (x - mean) / scale
    for layer in model["layers"]:
        weight = np.asarray(layer["weight"], dtype=np.float64)
        bias = np.asarray(layer["bias"], dtype=np.float64)
        hidden = activate(hidden @ weight + bias, layer["activation"])
    return float(hidden.reshape(-1)[0])


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


class LinUCB:
    def __init__(self, dim: int, alpha: float = 0.8) -> None:
        self.dim = dim
        self.alpha = alpha
        self.A = np.eye(dim, dtype=np.float64)
        self.b = np.zeros(dim, dtype=np.float64)

    def mean(self, x: np.ndarray) -> float:
        a_inv = np.linalg.inv(self.A)
        theta = a_inv @ self.b
        return float(theta @ x)

    def update(self, x: np.ndarray, reward: float) -> None:
        self.A += np.outer(x, x)
        self.b += reward * x


def reward_for(action: str) -> float:
    if action in {"like", "save", "worn", "purchase"}:
        return 1.0
    if action == "dislike":
        return 0.0
    return 0.25


def full_vector(content: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Pad a 7-d content vector to the Phase 1 feature width."""
    rest = rng.random(len(FEATURE_NAMES) - 7)
    # Prefer sparse one-hots for occasion/season blocks.
    rest[:] = 0.0
    rest[0] = 0.5  # temp_norm
    rest[1 + int(rng.integers(0, 4))] = 1.0
    rest[5 + int(rng.integers(0, 4))] = 1.0
    rest[-2] = float(rng.integers(0, 2))
    rest[-1] = float(rng.uniform(0.4, 0.8))
    return np.concatenate([content, rest])


def sample_content(rng: np.random.Generator, taste: np.ndarray, prefer: bool) -> np.ndarray:
    """Sample content features correlated with (or against) a user's taste."""
    base = rng.uniform(0.15, 0.85, size=7)
    aligned = 0.55 + 0.45 * (taste > 0).astype(np.float64)
    opposed = 0.55 - 0.45 * (taste > 0).astype(np.float64)
    mix = aligned if prefer else opposed
    return np.clip(0.35 * base + 0.65 * mix, 0.0, 1.0)


def latent_utility(content: np.ndarray, taste: np.ndarray) -> float:
    return float(taste @ (content - 0.5))


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Phase 2 personalization vs Phase 1")
    parser.add_argument("--model", type=Path, default=WEIGHTS / "ranker-v1.json")
    parser.add_argument("--out", type=Path, default=REPORTS / "phase2_eval.json")
    parser.add_argument("--users", type=int, default=48)
    parser.add_argument("--feedback-per-user", type=int, default=12)
    parser.add_argument("--eval-pairs-per-user", type=int, default=16)
    parser.add_argument("--blend", type=float, default=0.28)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not args.model.exists():
        raise SystemExit(f"Missing {args.model}. Run train_ranker.py first.")

    model = load_model(args.model)
    if model["feature_names"] != FEATURE_NAMES:
        raise SystemExit("Model feature_names do not match features.py")

    rng = np.random.default_rng(args.seed)
    phase1_wins = 0
    phase2_wins = 0
    linucb_wins = 0
    compared = 0
    users_ready = 0
    near_tie_phase1 = 0
    near_tie_phase2 = 0
    near_tie_n = 0

    for _ in range(args.users):
        taste = rng.normal(0.0, 1.0, size=7)
        taste = taste / (np.linalg.norm(taste) + 1e-9)
        bandit = LinUCB(dim=7, alpha=0.8)

        for _step in range(args.feedback_per_user):
            liked = sample_content(rng, taste, prefer=True)
            other = sample_content(rng, taste, prefer=False)
            action = str(rng.choice(["like", "save", "worn", "purchase"], p=[0.35, 0.2, 0.2, 0.25]))
            bandit.update(liked, reward_for(action))
            if rng.random() < 0.65:
                bandit.update(other, reward_for("dismiss" if rng.random() < 0.6 else "dislike"))

        users_ready += 1

        for _pair in range(args.eval_pairs_per_user):
            left = sample_content(rng, taste, prefer=True)
            right = sample_content(rng, taste, prefer=False)
            if latent_utility(left, taste) < latent_utility(right, taste):
                left, right = right, left

            winner = full_vector(left, rng)
            loser = full_vector(right, rng)

            p1_w = predict_proba(model, winner)
            p1_l = predict_proba(model, loser)
            if p1_w > p1_l:
                phase1_wins += 1

            personal_w = sigmoid(bandit.mean(left))
            personal_l = sigmoid(bandit.mean(right))
            if personal_w > personal_l:
                linucb_wins += 1

            p2_w = (1.0 - args.blend) * p1_w + args.blend * personal_w
            p2_l = (1.0 - args.blend) * p1_l + args.blend * personal_l
            if p2_w > p2_l:
                phase2_wins += 1

            if abs(p1_w - p1_l) < 0.08:
                near_tie_n += 1
                if p1_w > p1_l:
                    near_tie_phase1 += 1
                if p2_w > p2_l:
                    near_tie_phase2 += 1

            compared += 1

    phase1_acc = phase1_wins / compared if compared else 0.0
    phase2_acc = phase2_wins / compared if compared else 0.0
    linucb_acc = linucb_wins / compared if compared else 0.0
    report = {
        "model_version": "muse-ranker-v1+linucb",
        "phase1_model_version": "muse-ranker-v1",
        "n_users": args.users,
        "users_ready": users_ready,
        "n_eval_pairs": compared,
        "feedback_per_user": args.feedback_per_user,
        "personalization_blend": args.blend,
        "pairwise_accuracy_phase1_learned": round(phase1_acc, 4),
        "pairwise_accuracy_linucb_only": round(linucb_acc, 4),
        "pairwise_accuracy_phase2_personalized": round(phase2_acc, 4),
        "lift_vs_phase1": round(phase2_acc - phase1_acc, 4),
        "near_tie_pairs": near_tie_n,
        "near_tie_accuracy_phase1": round(near_tie_phase1 / near_tie_n, 4) if near_tie_n else None,
        "near_tie_accuracy_phase2": round(near_tie_phase2 / near_tie_n, 4) if near_tie_n else None,
        "actions_supported": ["like", "save", "dislike", "dismiss", "worn", "purchase"],
        "marketplace_ready": {
            "purchase_action": True,
            "source_field": ["wardrobe", "marketplace"],
            "product_ids_field": True,
        },
        "notes": [
            "Ground truth is each synthetic user's latent taste over Muse content features.",
            "Phase 1 is the exported MLP alone (global style prior, not user-specific).",
            "Phase 2 blends MLP with a per-user LinUCB fit on likes/saves/wears/purchases/dismissals/dislikes.",
            "Near-tie rows are pairs where |MLP(winner)-MLP(loser)| < 0.08.",
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
