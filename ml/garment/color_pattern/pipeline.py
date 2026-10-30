"""One photo in, one result per garment.

Each item has the type from ml/garment/infer.py plus color, pattern, and texture.
Pass a classification file to reuse boxes. With no file, the detector runs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, UnidentifiedImageError

from color import extract_colors
from pattern import classify_pattern
from texture import classify_texture

MODEL_VERSION = "color-pattern-v1"
GARMENT_ROOT = Path(__file__).resolve().parents[1]


def analyze(
    image: Image.Image | str | Path,
    classification: dict | list | None = None,
    *,
    k: int = 6,
) -> dict:
    try:
        opened = _open(image)
        box = _primary_box(classification)
        color = extract_colors(opened, box=box, k=k)
        pattern = classify_pattern(opened, box=box)
        texture = classify_texture(opened, box=box)
    except (OSError, UnidentifiedImageError, ValueError) as error:
        return {
            "status": "failed",
            "color": None,
            "pattern": {"primary": "unknown", "confidence": 0.0},
            "texture": {"primary": "unknown", "confidence": 0.0},
            "model_version": MODEL_VERSION,
            "error": str(error),
        }

    return {
        "status": "success",
        "color": color,
        "pattern": pattern,
        "texture": texture,
        "model_version": MODEL_VERSION,
    }


def classify_photo(
    image: Image.Image | str | Path,
    classification: dict | list | None = None,
    *,
    k: int = 6,
) -> dict:
    """Type, color, pattern, and texture for every garment in the photo."""
    try:
        opened = _open(image)
        if classification is None:
            return _join_type(opened, _from_type_model(opened), k)
        items = _detections(image, classification)
        garments = [_describe(opened, item, k) for item in items]
    except (OSError, UnidentifiedImageError, ValueError, FileNotFoundError, ImportError, RuntimeError) as error:
        return {
            "status": "failed",
            "garments": [],
            "model_version": MODEL_VERSION,
            "error": str(error),
        }

    return {
        "status": "success",
        "garments": garments,
        "model_version": MODEL_VERSION,
    }


def _from_type_model(image: Image.Image) -> dict:
    """SegFormer box plus FashionCLIP label. MobileNet is used only when it covers the taxonomy."""
    if str(GARMENT_ROOT) not in sys.path:
        sys.path.insert(0, str(GARMENT_ROOT))
    from inference.pipeline import ModelError, build_default_pipeline

    try:
        return build_default_pipeline().predict_image(
            image,
            include_embedding=False,
            include_mask=True,
        )
    except ModelError as error:
        raise RuntimeError(str(error)) from error


def _join_type(image: Image.Image, typed: dict, k: int) -> dict:
    header = {
        "status": typed.get("status") or "unclear",
        "reason": typed.get("reason"),
        "model_version": MODEL_VERSION,
        "type_model_version": typed.get("model_version"),
    }
    if header["status"] == "unclear" or not typed.get("bbox") or not typed.get("subcategory"):
        return {**header, "garments": []}
    return {**header, "garments": [_describe(image, _item_from_type(typed), k)]}


def _item_from_type(typed: dict) -> dict:
    return {
        "group": typed.get("category"),
        "type": typed.get("subcategory"),
        "category": typed.get("category"),
        "subcategory": typed.get("subcategory"),
        "confidence": typed.get("confidence"),
        "box": typed.get("bbox"),
        "reason": typed.get("reason"),
        "mask": _mask_array(typed.get("mask")),
    }


def _mask_array(mask: dict | None) -> np.ndarray | None:
    if not isinstance(mask, dict) or mask.get("encoding") != "rle-row-major":
        return None
    height = int(mask["height"])
    width = int(mask["width"])
    flat = np.zeros(height * width, dtype=np.uint8)
    index = 0
    value = int(mask.get("start_value") or 0)
    for count in mask.get("counts") or []:
        count = int(count)
        if value and count:
            flat[index : index + count] = 1
        index += count
        value = 1 - value
    small = flat.reshape(height, width)
    source_width = int(mask.get("source_width") or width)
    source_height = int(mask.get("source_height") or height)
    if (source_height, source_width) != small.shape:
        image = Image.fromarray(small * 255)
        image = image.resize((source_width, source_height), Image.Resampling.NEAREST)
        small = np.asarray(image) > 0
    return small


def _detections(
    image: Image.Image | str | Path,
    classification: dict | list | None,
) -> list[dict]:
    items = classification if isinstance(classification, list) else [classification]
    return [item for item in items if isinstance(item, dict)]


def _describe(image: Image.Image, item: dict, k: int) -> dict:
    box = _box(item)
    mask = item.get("mask")
    if not isinstance(mask, np.ndarray):
        mask = None
    described = {
        "group": item.get("group"),
        "type": item.get("type"),
        "confidence": item.get("confidence"),
        "box": box,
        "color": extract_colors(image, box=box, mask=mask, k=k),
        "pattern": classify_pattern(image, box=box),
        "texture": classify_texture(image, box=box),
    }
    if item.get("category") is not None:
        described["category"] = item.get("category")
    if item.get("subcategory") is not None:
        described["subcategory"] = item.get("subcategory")
    if "reason" in item:
        described["reason"] = item.get("reason")
    return described


def _box(item: dict) -> list[float] | None:
    box = item.get("box")
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return None
    return [float(value) for value in box]


def _open(image: Image.Image | str | Path) -> Image.Image:
    if isinstance(image, Image.Image):
        return image.convert("RGB")
    return Image.open(image).convert("RGB")


def _primary_box(classification: dict | list | None) -> list[float] | None:
    if not classification:
        return None
    items = classification if isinstance(classification, list) else [classification]
    boxes = [item for item in items if isinstance(item, dict) and item.get("box")]
    if not boxes:
        return None
    boxes.sort(key=lambda item: float(item.get("confidence") or 0), reverse=True)
    box = boxes[0]["box"]
    if len(box) != 4:
        return None
    return [float(value) for value in box]


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Garment type, color, pattern, and texture")
    parser.add_argument("image", type=Path)
    parser.add_argument(
        "--classification",
        type=Path,
        help="JSON from ml/garment/infer.py. Omit to run the detector.",
    )
    parser.add_argument("--k", type=int, default=6)
    args = parser.parse_args()
    classification = None
    if args.classification:
        classification = json.loads(args.classification.read_text(encoding="utf-8"))
    print(json.dumps(classify_photo(args.image, classification, k=args.k), indent=2))


if __name__ == "__main__":
    main()
