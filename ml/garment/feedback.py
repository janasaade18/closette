"""Store a user correction. Nothing here is added to training automatically."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from paths import RUNS
from taxonomy import MODEL_VERSION, load_taxonomy, type_to_group

CORRECTIONS = RUNS / "corrections.jsonl"


class CorrectionError(Exception):
    pass


def store_correction(body: dict, path: Path | None = None) -> dict:
    groups = type_to_group()
    predicted = _pair(body, "predicted_category", "predicted_subcategory", groups, required=False)
    corrected = _pair(body, "corrected_category", "corrected_subcategory", groups, required=True)
    confidence = body.get("confidence")
    if confidence is not None and not isinstance(confidence, (int, float)):
        raise CorrectionError("confidence must be a number")
    if isinstance(confidence, (int, float)) and not 0 <= float(confidence) <= 1:
        raise CorrectionError("confidence must be between 0 and 1")
    record = {
        "image_id": str(body.get("image_id") or ""),
        "predicted_category": predicted[0],
        "predicted_subcategory": predicted[1],
        "corrected_category": corrected[0],
        "corrected_subcategory": corrected[1],
        "confidence": None if confidence is None else round(float(confidence), 4),
        "model_version": str(body.get("model_version") or MODEL_VERSION),
        "taxonomy_version": load_taxonomy()["version"],
        "accepted_for_training": False,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    destination = CORRECTIONS if path is None else path
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
    return record


def _pair(body: dict, category_key: str, subcategory_key: str, groups: dict, required: bool):
    category = body.get(category_key)
    subcategory = body.get(subcategory_key)
    if not category and not subcategory:
        if required:
            raise CorrectionError(f"{subcategory_key} is required")
        return None, None
    if subcategory not in groups:
        raise CorrectionError(f"Unknown subcategory {subcategory}")
    expected = groups[subcategory]
    if category != expected:
        raise CorrectionError(f"{subcategory} belongs to {expected}, not {category}")
    return category, subcategory
