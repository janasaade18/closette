"""Stable classify response. Additive fields are documented in docs/CONTRACT.md."""

from __future__ import annotations

from taxonomy import MODEL_VERSION

REQUIRED_FIELDS = (
    "status",
    "category",
    "subcategory",
    "confidence",
    "bbox",
    "mask",
    "embedding",
    "model_version",
)

# bbox is [x_min, y_min, x_max, y_max] in original-image pixels.
# Origin is the top-left. x grows right, y grows down.
# x_min and y_min are inclusive. x_max and y_max are exclusive, matching PIL crop.
BBOX_CONVENTION = "xyxy-exclusive-top-left"

# mask.counts is row-major run-length encoding of a binary mask.
# Runs alternate starting with zeros. A mask that starts with a foreground
# pixel therefore begins with a zero-length background run.
MASK_ENCODING = "rle-row-major"


def classification_body(
    *,
    status: str,
    category: str | None,
    subcategory: str | None,
    confidence: float | None,
    bbox: list[int] | None,
    mask: dict | None,
    embedding: list[float] | None,
    reason: str | None,
    alternatives: list[dict] | None,
    latency_ms: float,
    models: dict,
) -> dict:
    if confidence is not None and not 0.0 <= confidence <= 1.0:
        raise ValueError("confidence must be between 0 and 1")
    payload = {
        "status": status,
        "category": category,
        "subcategory": subcategory,
        "confidence": None if confidence is None else round(confidence, 4),
        "bbox": bbox,
        "mask": mask,
        "embedding": embedding,
        "model_version": MODEL_VERSION,
        "reason": reason,
        "alternatives": alternatives,
        "latency_ms": round(latency_ms, 1),
        "models": models,
    }
    missing = [field for field in REQUIRED_FIELDS if field not in payload]
    if missing:
        raise RuntimeError(f"response missing {missing}")
    return payload


def error_body(code: str, message: str) -> dict:
    return {
        "status": "error",
        "error": code,
        "message": message,
        "model_version": MODEL_VERSION,
    }
