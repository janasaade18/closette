"""Generate synthetic wardrobes, outfits, and preference labels for Muse.

Labels come from a fashion "teacher" heuristic that is intentionally richer
than the hand-tuned baseline weights. The learned model should beat a simple
average of baseline features on held-out synthetic pairs.

Output (under data/):
  products.jsonl       marketplace-style catalog rows (future retrieval)
  wardrobes.jsonl      user wardrobes
  examples.jsonl       ranked example rows with feature vectors + labels
  pairs.jsonl          pairwise preference rows (winner beats loser)
  meta.json            generation stats
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from features import FEATURE_NAMES, MISSING_FILL, vector_from_parts

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

TAXONOMY = {
    "tops": ["t-shirt", "shirt", "polo", "blouse", "sweater", "hoodie", "tank-top", "sweatshirt"],
    "bottoms": ["jeans", "trousers", "chinos", "shorts", "skirt", "leggings"],
    "one-piece": ["dress", "jumpsuit", "romper"],
    "outerwear": ["jacket", "coat", "blazer", "trench-coat", "raincoat"],
    "footwear": ["sneakers", "boots", "sandals", "formal-shoes", "flats", "heels"],
    "accessories": ["hat", "scarf", "belt", "bag"],
}

COLORS = [
    "black",
    "white",
    "off-white",
    "grey",
    "navy",
    "blue",
    "beige",
    "brown",
    "olive",
    "burgundy",
    "cream",
    "tan",
    "red",
    "pink",
    "green",
]
NEUTRALS = {"black", "white", "off-white", "grey", "charcoal", "beige", "cream", "tan", "brown", "navy"}
FORMALITY = {
    "t-shirt": "casual",
    "hoodie": "casual",
    "sweatshirt": "casual",
    "tank-top": "casual",
    "jeans": "casual",
    "shorts": "casual",
    "sneakers": "casual",
    "sandals": "casual",
    "shirt": "smart-casual",
    "polo": "smart-casual",
    "blouse": "smart-casual",
    "chinos": "smart-casual",
    "trousers": "smart-casual",
    "flats": "smart-casual",
    "blazer": "work",
    "formal-shoes": "formal",
    "heels": "formal",
    "dress": "smart-casual",
    "coat": "smart-casual",
    "jacket": "casual",
}
STYLE_POOL = ["minimal", "classic", "street", "sporty", "elegant", "smart"]
OCCASIONS = ["casual", "smart-casual", "work", "formal"]
SEASONS = ["spring", "summer", "fall", "winter"]
BRANDS = ["North", "Morrow", "Orbit", "Line", "Hearth", "Atelier"]


def formal_rank(value: str | None) -> int:
    order = {"casual": 0, "smart-casual": 1, "work": 2, "formal": 3}
    return order.get(value or "", 1)


def occasion_rank(value: str | None) -> int:
    return formal_rank(value)


def color_pair_score(left: str, right: str) -> float:
    if left == right:
        return 0.85
    if left in NEUTRALS or right in NEUTRALS:
        return 0.9
    families = {
        "red": "red",
        "burgundy": "red",
        "pink": "pink",
        "blue": "blue",
        "navy": "blue",
        "sky blue": "blue",
        "green": "green",
        "olive": "green",
        "mint": "green",
    }
    if families.get(left) and families.get(left) == families.get(right):
        return 0.8
    return 0.55


def temp_range_for(subcategory: str, season_bias: str | None) -> tuple[float, float]:
    if subcategory in {"coat", "sweater", "hoodie", "boots"}:
        return (-5.0, 16.0)
    if subcategory in {"sandals", "shorts", "tank-top"}:
        return (18.0, 40.0)
    if subcategory in {"blazer", "trousers", "formal-shoes"}:
        return (8.0, 28.0)
    if season_bias == "winter":
        return (0.0, 18.0)
    if season_bias == "summer":
        return (16.0, 36.0)
    return (5.0, 30.0)


def make_garment(rng: random.Random, gid: str, category: str, subcategory: str) -> dict:
    color = rng.choice(COLORS)
    secondary = []
    if rng.random() < 0.25:
        other = rng.choice(COLORS)
        if other != color:
            secondary.append(other)
    formality = FORMALITY.get(subcategory, "casual")
    styles = rng.sample(STYLE_POOL, k=rng.randint(1, 2))
    season = rng.choice(SEASONS)
    tmin, tmax = temp_range_for(subcategory, season)
    return {
        "id": gid,
        "category": category,
        "subcategory": subcategory,
        "colors": {"primary": color, "secondary": secondary},
        "pattern": rng.choice(["solid", "solid", "solid", "striped", "plaid"]),
        "formality": formality,
        "style_tags": styles,
        "seasons": [season] if rng.random() < 0.7 else [season, rng.choice(SEASONS)],
        "temperature_range_c": {"min_c": tmin, "max_c": tmax},
        "availability": "clean",
        "brand": rng.choice(BRANDS),
        "price": round(rng.uniform(25, 180), 2),
    }


def build_catalog(rng: random.Random, n: int) -> list[dict]:
    items = []
    for i in range(n):
        category = rng.choice(list(TAXONOMY.keys()))
        subcategory = rng.choice(TAXONOMY[category])
        items.append(make_garment(rng, f"sku-{i:04d}", category, subcategory))
    return items


def build_wardrobe(rng: random.Random, catalog: list[dict], user_id: str) -> dict:
    # Ensure enough structure for outfits.
    by_cat: dict[str, list[dict]] = {key: [] for key in TAXONOMY}
    for item in catalog:
        by_cat[item["category"]].append(item)

    picks: list[dict] = []
    for category, count in (
        ("tops", rng.randint(3, 6)),
        ("bottoms", rng.randint(2, 4)),
        ("footwear", rng.randint(2, 3)),
        ("outerwear", rng.randint(1, 2)),
        ("one-piece", rng.randint(0, 2)),
        ("accessories", rng.randint(0, 2)),
    ):
        pool = by_cat[category]
        if not pool:
            continue
        for item in rng.sample(pool, k=min(count, len(pool))):
            clone = dict(item)
            clone["id"] = f"{user_id}-{item['id']}"
            picks.append(clone)

    profile = {
        "preferred_styles": rng.sample(STYLE_POOL, k=2),
        "favorite_colors": rng.sample(COLORS, k=2),
        "disliked_colors": rng.sample([c for c in COLORS if c not in NEUTRALS], k=1),
        "preferred_garment_types": rng.sample(
            [s for subs in TAXONOMY.values() for s in subs],
            k=3,
        ),
    }
    return {"user_id": user_id, "wardrobe": picks, "profile": profile}


def candidate_outfits(wardrobe: list[dict], rng: random.Random) -> list[dict]:
    tops = [g for g in wardrobe if g["category"] == "tops"]
    bottoms = [g for g in wardrobe if g["category"] == "bottoms"]
    footwear = [g for g in wardrobe if g["category"] == "footwear"]
    outer = [g for g in wardrobe if g["category"] == "outerwear"]
    ones = [g for g in wardrobe if g["category"] == "one-piece"]
    outfits = []

    for top in tops[:8]:
        for bottom in bottoms[:6]:
            for shoe in footwear[:4]:
                roles = {"top": top["id"], "bottom": bottom["id"], "footwear": shoe["id"]}
                items = [top, bottom, shoe]
                if outer and rng.random() < 0.35:
                    coat = rng.choice(outer)
                    roles["outerwear"] = coat["id"]
                    items.append(coat)
                outfits.append({"roles": roles, "items": items})

    for dress in ones[:4]:
        for shoe in footwear[:4]:
            roles = {"one_piece": dress["id"], "footwear": shoe["id"]}
            items = [dress, shoe]
            if outer and rng.random() < 0.3:
                coat = rng.choice(outer)
                roles["outerwear"] = coat["id"]
                items.append(coat)
            outfits.append({"roles": roles, "items": items})

    rng.shuffle(outfits)
    return outfits[:120]


def content_features(outfit: dict, context: dict, profile: dict) -> dict:
    items = outfit["items"]
    occasion = context.get("occasion")
    temp = context.get("weather", {}).get("temperature_c")
    season = context.get("season")

    # occasion_match
    occ_scores = []
    for item in items:
        affinity = 1.0 - abs(formal_rank(item.get("formality")) - occasion_rank(occasion)) / 3.0
        tag_hit = 1.0 if occasion and occasion in (item.get("style_tags") or []) else None
        parts = [affinity]
        if tag_hit is not None:
            parts.append(tag_hit)
        occ_scores.append(sum(parts) / len(parts))
    occasion_match = sum(occ_scores) / len(occ_scores) if occ_scores else None

    # style_match
    preferred = profile.get("preferred_styles") or []
    style_scores = []
    for item in items:
        tags = item.get("style_tags") or []
        if not tags or not preferred:
            continue
        style_scores.append(1.0 if any(t in preferred for t in tags) else 0.25)
    style_match = sum(style_scores) / len(style_scores) if style_scores else None

    # type preference
    preferred_types = profile.get("preferred_garment_types") or []
    known = [i for i in items if i.get("subcategory") or i.get("category")]
    if preferred_types and known:
        hits = sum(
            1
            for i in known
            if i.get("subcategory") in preferred_types or i.get("category") in preferred_types
        )
        type_pref = hits / len(known)
    else:
        type_pref = None

    fav = profile.get("favorite_colors") or []
    dislike = profile.get("disliked_colors") or []
    color_scores = []
    for item in items:
        primary = (item.get("colors") or {}).get("primary")
        if not primary:
            continue
        if primary in dislike:
            color_scores.append(0.0)
        elif primary in fav:
            color_scores.append(1.0)
        else:
            color_scores.append(0.45)
    color_preference = sum(color_scores) / len(color_scores) if color_scores else None

    primaries = [(i.get("colors") or {}).get("primary") for i in items]
    primaries = [c for c in primaries if c]
    if len(primaries) >= 2:
        pairs = []
        for i in range(len(primaries)):
            for j in range(i + 1, len(primaries)):
                pairs.append(color_pair_score(primaries[i], primaries[j]))
        color_harmony = sum(pairs) / len(pairs)
    else:
        color_harmony = None

    weather_scores = []
    for item in items:
        tr = item.get("temperature_range_c") or {}
        parts = []
        if isinstance(temp, (int, float)) and (tr.get("min_c") is not None or tr.get("max_c") is not None):
            fits = (tr.get("min_c") is None or temp >= tr["min_c"]) and (
                tr.get("max_c") is None or temp <= tr["max_c"]
            )
            parts.append(1.0 if fits else 0.0)
        seasons = item.get("seasons") or []
        if season and seasons:
            parts.append(1.0 if season in seasons else 0.0)
        if parts:
            weather_scores.append(sum(parts) / len(parts))
    weather_suitability = sum(weather_scores) / len(weather_scores) if weather_scores else None

    needs_layer = (isinstance(temp, (int, float)) and temp < 18) or season in {"fall", "winter"}
    has_outer = any(i.get("category") == "outerwear" for i in items)
    if needs_layer or occasion in {"formal", "work"}:
        context_layer = 1.0 if has_outer else 0.35
    else:
        context_layer = None

    return {
        "occasion_match": occasion_match,
        "style_match": style_match,
        "garment_type_preference": type_pref,
        "color_preference": color_preference,
        "color_harmony": color_harmony,
        "weather_suitability": weather_suitability,
        "context_layer": context_layer,
    }


def teacher_score(outfit: dict, context: dict, profile: dict) -> float:
    """Richer oracle used only to create training labels."""
    feats = content_features(outfit, context, profile)
    weights = {
        "occasion_match": 0.30,
        "style_match": 0.12,
        "garment_type_preference": 0.08,
        "color_preference": 0.16,
        "color_harmony": 0.14,
        "weather_suitability": 0.14,
        "context_layer": 0.06,
    }
    num = den = 0.0
    for name, weight in weights.items():
        value = feats.get(name)
        if value is None:
            continue
        num += weight * float(value)
        den += weight
    base = num / den if den else 0.5

    # Extra fashion penalties/bonuses the baseline weights under-emphasize.
    items = outfit["items"]
    formality_spread = max(formal_rank(i.get("formality")) for i in items) - min(
        formal_rank(i.get("formality")) for i in items
    )
    if formality_spread >= 3:
        base -= 0.12
    if any((i.get("colors") or {}).get("primary") in (profile.get("disliked_colors") or []) for i in items):
        base -= 0.18
    if all((i.get("colors") or {}).get("primary") in NEUTRALS for i in items):
        base += 0.04
    return max(0.0, min(1.0, base))


def baseline_score(feats: dict) -> float:
    weights = {
        "occasion_match": 0.27,
        "style_match": 0.16,
        "garment_type_preference": 0.09,
        "color_preference": 0.14,
        "color_harmony": 0.09,
        "weather_suitability": 0.16,
        "context_layer": 0.09,
    }
    num = den = 0.0
    for name, weight in weights.items():
        value = feats.get(name)
        if value is None:
            continue
        num += weight * float(value)
        den += weight
    return num / den if den else MISSING_FILL


def make_context(rng: random.Random) -> dict:
    occasion = rng.choice(OCCASIONS)
    season = rng.choice(SEASONS)
    if season == "summer":
        temp = rng.uniform(22, 34)
    elif season == "winter":
        temp = rng.uniform(-2, 12)
    else:
        temp = rng.uniform(8, 24)
    return {
        "occasion": occasion,
        "season": season,
        "weather": {"temperature_c": round(temp, 1), "condition": rng.choice(["clear", "rain", "cloudy"])},
    }


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic Muse ranking data")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--catalog-size", type=int, default=240)
    parser.add_argument("--users", type=int, default=40)
    parser.add_argument("--contexts-per-user", type=int, default=4)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    catalog = build_catalog(rng, args.catalog_size)
    wardrobes = [build_wardrobe(rng, catalog, f"user-{i:03d}") for i in range(args.users)]

    examples: list[dict] = []
    pairs: list[dict] = []
    example_id = 0

    for wardrobe_doc in wardrobes:
        user_id = wardrobe_doc["user_id"]
        profile = wardrobe_doc["profile"]
        wardrobe = wardrobe_doc["wardrobe"]
        for _ in range(args.contexts_per_user):
            context = make_context(rng)
            outfits = candidate_outfits(wardrobe, rng)
            if len(outfits) < 4:
                continue
            scored = []
            for outfit in outfits:
                feats = content_features(outfit, context, profile)
                teacher = teacher_score(outfit, context, profile)
                base = baseline_score(feats)
                vector = vector_from_parts(
                    content=feats,
                    temperature_c=context["weather"]["temperature_c"],
                    occasion=context["occasion"],
                    season=context["season"],
                    has_outerwear=any(i.get("category") == "outerwear" for i in outfit["items"]),
                    n_items=len(outfit["items"]),
                )
                row = {
                    "id": f"ex-{example_id:06d}",
                    "user_id": user_id,
                    "context": context,
                    "profile": profile,
                    "item_ids": [i["id"] for i in outfit["items"]],
                    "roles": outfit["roles"],
                    "features": feats,
                    "feature_vector": vector,
                    "teacher_score": round(teacher, 4),
                    "baseline_score": round(base, 4),
                }
                scored.append(row)
                example_id += 1

            scored.sort(key=lambda row: row["teacher_score"], reverse=True)
            cutoff = scored[max(1, len(scored) // 3)]["teacher_score"]
            for row in scored:
                row["label"] = 1 if row["teacher_score"] >= cutoff else 0
                examples.append(row)

            # Preference pairs: strong winners vs weak losers
            winners = [row for row in scored if row["label"] == 1][:8]
            losers = [row for row in scored if row["label"] == 0][:12]
            for winner in winners:
                for loser in losers[:3]:
                    if winner["teacher_score"] - loser["teacher_score"] < 0.05:
                        continue
                    pairs.append(
                        {
                            "user_id": user_id,
                            "context": context,
                            "winner_id": winner["id"],
                            "loser_id": loser["id"],
                            "winner_vector": winner["feature_vector"],
                            "loser_vector": loser["feature_vector"],
                            "margin": round(winner["teacher_score"] - loser["teacher_score"], 4),
                        }
                    )

    write_jsonl(DATA / "products.jsonl", catalog)
    write_jsonl(DATA / "wardrobes.jsonl", wardrobes)
    write_jsonl(DATA / "examples.jsonl", examples)
    write_jsonl(DATA / "pairs.jsonl", pairs)
    meta = {
        "seed": args.seed,
        "catalog_size": len(catalog),
        "users": len(wardrobes),
        "examples": len(examples),
        "pairs": len(pairs),
        "positive_examples": sum(1 for row in examples if row["label"] == 1),
        "feature_names": FEATURE_NAMES,
    }
    (DATA / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
