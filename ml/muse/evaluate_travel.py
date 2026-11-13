"""Phase 4 offline eval: multi-day rotation + luggage packing heuristics."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORTS = ROOT / "reports"


def core_key(items: list[str]) -> str:
    return "|".join(sorted(items[:3]))


def pack_unique(day_outfits: list[list[str]]) -> int:
    return len({item for outfit in day_outfits for item in outfit})


def select_with_rotation(candidate_sets: list[list[list[str]]], max_core_reuses: int = 1) -> list[list[str]]:
    usage: dict[str, int] = {}
    chosen: list[list[str]] = []
    for options in candidate_sets:
        best = None
        best_score = -1e9
        for outfit in options:
            penalty = 0.0
            for item in outfit:
                used = usage.get(item, 0)
                if used > max_core_reuses:
                    penalty += 0.35 * (used - max_core_reuses)
                elif used > 0:
                    penalty += 0.08 * used
            core = core_key(outfit)
            penalty += 0.45 * usage.get(f"core:{core}", 0)
            score = 1.0 - penalty
            if score > best_score:
                best_score = score
                best = outfit
        assert best is not None
        for item in best:
            usage[item] = usage.get(item, 0) + 1
        usage[f"core:{core_key(best)}"] = usage.get(f"core:{core_key(best)}", 0) + 1
        chosen.append(best)
    return chosen


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Phase 4 travel packing")
    parser.add_argument("--out", type=Path, default=REPORTS / "phase4_eval.json")
    parser.add_argument("--trials", type=int, default=120)
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    wardrobe = [f"g{i:02d}" for i in range(18)]

    greedy_uniques = []
    rotated_uniques = []
    repeat_cores_greedy = 0
    repeat_cores_rotated = 0
    luggage_fit = 0

    for _ in range(args.trials):
        days = rng.randint(3, 6)
        candidate_sets: list[list[list[str]]] = []
        for _day in range(days):
            options = []
            for _opt in range(4):
                options.append(rng.sample(wardrobe, k=3))
            candidate_sets.append(options)

        greedy = [opts[0] for opts in candidate_sets]
        rotated = select_with_rotation(candidate_sets, max_core_reuses=1)

        greedy_uniques.append(pack_unique(greedy))
        rotated_uniques.append(pack_unique(rotated))

        greedy_cores = [core_key(o) for o in greedy]
        rotated_cores = [core_key(o) for o in rotated]
        if len(greedy_cores) != len(set(greedy_cores)):
            repeat_cores_greedy += 1
        if len(rotated_cores) != len(set(rotated_cores)):
            repeat_cores_rotated += 1

        max_items = 10
        if pack_unique(rotated) <= max_items:
            luggage_fit += 1
        else:
            # Drop single-use extras (simulate luggage optimizer on accessories = last item).
            usage = {}
            for outfit in rotated:
                for item in outfit:
                    usage[item] = usage.get(item, 0) + 1
            extras = [item for item, count in usage.items() if count == 1]
            kept = [item for item in usage if item not in extras[: max(0, pack_unique(rotated) - max_items)]]
            if len(kept) <= max_items:
                luggage_fit += 1

    report = {
        "model_version": "muse-travel-v1",
        "phase": 4,
        "n_trials": args.trials,
        "mean_unique_items_greedy_top1": round(sum(greedy_uniques) / len(greedy_uniques), 4),
        "mean_unique_items_with_rotation": round(sum(rotated_uniques) / len(rotated_uniques), 4),
        "core_repeat_rate_greedy": round(repeat_cores_greedy / args.trials, 4),
        "core_repeat_rate_rotated": round(repeat_cores_rotated / args.trials, 4),
        "luggage_fit_rate_max_10": round(luggage_fit / args.trials, 4),
        "stack": ["mlp", "linucb", "marketplace_retrieval", "rotation", "luggage"],
        "uses_rag": False,
        "uses_qwen_qlora": False,
        "notes": [
            "Travel packing reuses Muse recommend() per day; Phase 4 adds rotation + luggage optimization.",
            "Existing POST /v1/outfits/recommend behavior is unchanged.",
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
