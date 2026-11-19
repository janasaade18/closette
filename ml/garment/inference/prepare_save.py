"""Warm save-prep: classify + cutout using the already-loaded pipeline.

Nest used to spawn a fresh `quality.cli` process per save, which reloaded
FashionCLIP + SegFormer and timed out phones. Call this from the long-lived
uvicorn process instead.
"""

from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

from PIL import Image

from quality.cutout import rgba_cutout
from quality.lighting import score_lighting

GARMENT_ROOT = Path(__file__).resolve().parents[1]
COLOR_PATTERN = GARMENT_ROOT / "color_pattern"


def prepare_wardrobe_save(pipeline, image: Image.Image, *, k: int = 6) -> dict:
    lighting = score_lighting(image)
    typed = pipeline.predict_image(image, include_embedding=False, include_mask=False)
    status = typed.get("status") or "unclear"
    if status == "unclear" or not typed.get("bbox") or not typed.get("subcategory"):
        return {
            "status": status,
            "reason": typed.get("reason") or "no_garment",
            "lighting": lighting,
            "garments": [],
            "cutout_png_base64": None,
            "model_version": typed.get("model_version"),
            "type_model_version": typed.get("model_version"),
        }

    mask = _cutout_mask(pipeline, image)
    cutout = rgba_cutout(image, mask, box=typed.get("bbox"))
    buffer = io.BytesIO()
    cutout.save(buffer, format="PNG")
    look = _describe_look(image, typed.get("bbox"), mask, k)
    garment = {
        "group": typed.get("category"),
        "type": typed.get("subcategory"),
        "category": typed.get("category"),
        "subcategory": typed.get("subcategory"),
        "confidence": typed.get("confidence"),
        "box": typed.get("bbox"),
        "color": look["color"],
        "pattern": look["pattern"],
        "texture": look["texture"],
    }
    return {
        "status": "success",
        "reason": typed.get("reason"),
        "lighting": lighting,
        "garments": [garment],
        "cutout_png_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "model_version": "color-pattern-v1",
        "type_model_version": typed.get("model_version"),
    }


def _cutout_mask(pipeline, image: Image.Image):
    segmenter = getattr(pipeline, "segmenter", None)
    if segmenter is None:
        return None
    try:
        localization = segmenter.segment(image)
    except Exception:
        return None
    if localization is None:
        return None
    return localization.mask


def _describe_look(image: Image.Image, box, mask, k: int) -> dict:
    """Color / pattern / texture — mask blanks background so heads see fabric."""
    unknown = {"primary": "unknown", "confidence": 0.0}
    try:
        if str(COLOR_PATTERN) not in sys.path:
            sys.path.insert(0, str(COLOR_PATTERN))
        from color import extract_colors
        from pattern import classify_pattern
        from texture import classify_texture

        return {
            "color": extract_colors(image, box=box, mask=mask, k=k),
            "pattern": classify_pattern(image, box=box, mask=mask),
            "texture": classify_texture(image, box=box, mask=mask),
        }
    except Exception:
        return {"color": None, "pattern": unknown, "texture": unknown}
