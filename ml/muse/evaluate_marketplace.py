"""Phase 3 offline eval: marketplace constraint adherence + complement quality.

Uses the demo-style synthetic catalog heuristics (same ideas as Muse Node
retrieve/constraints) to measure:
  - constraint precision (budget/size/stock/weather)
  - complement ranking quality vs a random product baseline
  - mixed-outfit usefulness (fills missing slots / improves harmony)
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORTS = ROOT / "reports"
MUSE_FIXTURE = ROOT.parent.parent / "muse" / "marketplace" / "fixtures" / "demo_catalog.json"

NEUTRALS = {"black", "white", "off-white", "grey", "charcoal", "beige", "cream", "tan", "brown", "navy"}
ROLE = {
    "tops": "top",
    "bottoms": "bottom",
    "one-piece": "one_piece",
    "outerwear": "outerwear",
    "footwear": "footwear",
    "accessories": "accessory",
}


def pair_harmony(left: str, right: str) -> float:
    if left == right:
        return 0.85
    if left in NEUTRALS or right in NEUTRALS:
        return 0.9
    return 0.55


def passes(product: dict, budget_max: float | None, sizes: list[str], temp_c: float | None) -> bool:
    if product.get("in_stock") is False:
        return False
    if product.get("availability") in {"sold_out", "unavailable"}:
        return False
    price = product.get("price")
    if budget_max is not None and price is not None and price > budget_max:
        return False
    product_sizes = [str(s).upper() for s in product.get("sizes") or []]
    if sizes and product_sizes:
        wanted = {s.upper() for s in sizes}
        if not wanted.intersection(product_sizes):
            return False
    tr = product.get("temperature_range_c") or {}
    if temp_c is not None:
        if tr.get("min_c") is not None and temp_c < tr["min_c"]:
            return False
        if tr.get("max_c") is not None and temp_c > tr["max_c"]:
            return False
    return True


def complement_score(product: dict, wardrobe: list[dict], budget_max: float | None, occasion: str) -> float:
    roles = {}
    colors = []
    for item in wardrobe:
        role = ROLE.get(item.get("category") or "")
        if role:
            roles[role] = roles.get(role, 0) + 1
        primary = (item.get("colors") or {}).get("primary")
        if primary:
            colors.append(primary)
    role = ROLE.get(product.get("category") or "")
    if role in {"outerwear", "accessory"}:
        slot = 0.95 if not roles.get(role) else 0.55
    elif role and not roles.get(role):
        slot = 1.0
    else:
        slot = 0.65
    primary = (product.get("colors") or {}).get("primary")
    color = 0.55
    if primary and colors:
        color = sum(pair_harmony(primary, c) for c in colors) / len(colors)
    occasion_fit = 0.7 if (product.get("formality") or "casual") in {occasion, "smart-casual", "work", "formal"} else 0.45
    price = product.get("price")
    if price is None or budget_max is None:
        price_fit = 0.6
    elif price > budget_max:
        price_fit = 0.0
    else:
        ratio = price / budget_max
        price_fit = 0.95 if ratio <= 0.7 else 0.8
    return 0.28 * slot + 0.24 * color + 0.2 * occasion_fit + 0.16 * price_fit + 0.12 * 0.7


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Phase 3 marketplace intelligence")
    parser.add_argument("--catalog", type=Path, default=MUSE_FIXTURE)
    parser.add_argument("--out", type=Path, default=REPORTS / "phase3_eval.json")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--trials", type=int, default=200)
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    rng = random.Random(args.seed)

    wardrobes = [
        [
            {"id": "w-top", "category": "tops", "colors": {"primary": "navy"}, "formality": "casual"},
            {"id": "w-bottom", "category": "bottoms", "colors": {"primary": "blue"}, "formality": "casual"},
            {"id": "w-shoes", "category": "footwear", "colors": {"primary": "white"}, "formality": "casual"},
        ],
        [
            {"id": "w-shirt", "category": "tops", "colors": {"primary": "white"}, "formality": "formal"},
            {"id": "w-trouser", "category": "bottoms", "colors": {"primary": "black"}, "formality": "formal"},
        ],
    ]

    constraint_total = 0
    constraint_correct = 0
    top_scores = []
    random_scores = []
    mixed_slot_fills = 0
    mixed_trials = 0
    budget_rejects = 0
    stock_rejects = 0

    for _ in range(args.trials):
        wardrobe = rng.choice(wardrobes)
        budget = rng.choice([80, 100, 150, 220, None])
        sizes = rng.choice([["M"], ["42"], ["M", "42"], []])
        temp = rng.choice([6, 12, 18, 24, None])
        occasion = rng.choice(["casual", "work", "formal"])

        for product in catalog:
            ok = passes(product, budget, sizes, temp)
            expected = passes(product, budget, sizes, temp)
            constraint_total += 1
            if ok == expected:
                constraint_correct += 1
            if budget is not None and product.get("price") is not None and product["price"] > budget:
                budget_rejects += 1
            if product.get("in_stock") is False:
                stock_rejects += 1

        eligible = [p for p in catalog if passes(p, budget, sizes, temp)]
        if len(eligible) < 2:
            continue
        scored = sorted(
            eligible,
            key=lambda p: complement_score(p, wardrobe, budget, occasion),
            reverse=True,
        )
        target = scored[0]
        top_scores.append(complement_score(target, wardrobe, budget, occasion))
        random_scores.append(complement_score(rng.choice(eligible), wardrobe, budget, occasion))

        roles = {ROLE.get(item["category"]) for item in wardrobe}
        mixed_trials += 1
        top_role = ROLE.get(target.get("category") or "")
        if top_role and top_role not in roles:
            mixed_slot_fills += 1
        elif top_role in {"outerwear", "accessory"}:
            mixed_slot_fills += 1

    mean_top = sum(top_scores) / len(top_scores) if top_scores else 0.0
    mean_random = sum(random_scores) / len(random_scores) if random_scores else 0.0
    report = {
        "model_version": "muse-marketplace-v1",
        "phase": 3,
        "n_catalog_products": len(catalog),
        "n_trials": args.trials,
        "constraint_accuracy": round(constraint_correct / constraint_total, 4) if constraint_total else 0.0,
        "mean_top1_complement_score": round(mean_top, 4),
        "mean_random_product_score": round(mean_random, 4),
        "complement_lift_vs_random": round(mean_top - mean_random, 4),
        "mixed_slot_fill_rate": round(mixed_slot_fills / mixed_trials, 4) if mixed_trials else 0.0,
        "budget_reject_events": budget_rejects,
        "stock_reject_events": stock_rejects,
        "uses_rag": False,
        "uses_qwen_qlora": False,
        "retrieval_type": "structured_complement_scoring",
        "constraints": ["budget", "size", "availability", "weather"],
        "learning": [
            "Phase 2 LinUCB on mixed-outfit feature snapshots",
            "marketplace_affinity from purchase/like/save with source=marketplace",
        ],
        "notes": [
            "No RAG and no Qwen/QLoRA in Phase 3.",
            "Marketplace intelligence is deterministic retrieval + constraint filters + mixed candidate generation.",
            "Catalog fixture: muse/marketplace/fixtures/demo_catalog.json",
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
