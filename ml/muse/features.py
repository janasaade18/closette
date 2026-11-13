"""Feature contract shared with muse/ranking/learned.js.

Keep names and order stable. Node loads the exported JSON and builds the
same vector from Muse's content features + request context.
"""

from __future__ import annotations

FEATURE_NAMES: list[str] = [
    # Content signals (same names as muse/ranking FEATURES.md)
    "occasion_match",
    "style_match",
    "garment_type_preference",
    "color_preference",
    "color_harmony",
    "weather_suitability",
    "context_layer",
    # Context / structure
    "temp_norm",
    "occasion_casual",
    "occasion_smart_casual",
    "occasion_work",
    "occasion_formal",
    "season_spring",
    "season_summer",
    "season_fall",
    "season_winter",
    "has_outerwear",
    "n_items_norm",
]

MISSING_FILL = 0.5

OCCASIONS = ("casual", "smart-casual", "work", "formal")
SEASONS = ("spring", "summer", "fall", "winter")


def temp_norm(temperature_c: float | None) -> float:
    if temperature_c is None:
        return MISSING_FILL
    # Map roughly [-20, 40] → [0, 1]
    return max(0.0, min(1.0, (float(temperature_c) + 20.0) / 60.0))


def one_hot(value: str | None, choices: tuple[str, ...]) -> list[float]:
    if not value:
        return [0.0] * len(choices)
    return [1.0 if value == choice else 0.0 for choice in choices]


def content_or_fill(features: dict, name: str) -> float:
    value = features.get(name)
    if value is None:
        return MISSING_FILL
    return float(value)


def vector_from_parts(
    *,
    content: dict,
    temperature_c: float | None,
    occasion: str | None,
    season: str | None,
    has_outerwear: bool,
    n_items: int,
) -> list[float]:
    vec: list[float] = [
        content_or_fill(content, "occasion_match"),
        content_or_fill(content, "style_match"),
        content_or_fill(content, "garment_type_preference"),
        content_or_fill(content, "color_preference"),
        content_or_fill(content, "color_harmony"),
        content_or_fill(content, "weather_suitability"),
        content_or_fill(content, "context_layer"),
        temp_norm(temperature_c),
        *one_hot(occasion, OCCASIONS),
        *one_hot(season, SEASONS),
        1.0 if has_outerwear else 0.0,
        max(0.0, min(1.0, n_items / 5.0)),
    ]
    if len(vec) != len(FEATURE_NAMES):
        raise RuntimeError(f"feature length {len(vec)} != {len(FEATURE_NAMES)}")
    return vec
