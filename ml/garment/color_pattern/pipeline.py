"""One photo in, one result per garment.

Each item has the type from ml/garment/infer.py plus color, pattern, and texture.
Pass a classification file to reuse boxes. With no file, the detector runs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

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
        items = _detections(image, classification)
        garments = [_describe(opened, item, k) for item in items]
    except (OSError, UnidentifiedImageError, ValueError, FileNotFoundError, ImportError) as error:
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


def _detections(
    image: Image.Image | str | Path,
    classification: dict | list | None,
) -> list[dict]:
    if classification is not None:
        items = classification if isinstance(classification, list) else [classification]
        return [item for item in items if isinstance(item, dict)]
    if isinstance(image, Image.Image):
        raise ValueError("detection needs an image file")
    if str(GARMENT_ROOT) not in sys.path:
        sys.path.insert(0, str(GARMENT_ROOT))
    from infer import classify_garments

    return classify_garments(
        Path(image),
        detector_path=GARMENT_ROOT / "weights" / "detector.pt",
        classifier_path=GARMENT_ROOT / "weights" / "classifier.pt",
    )


def _describe(image: Image.Image, item: dict, k: int) -> dict:
    box = _box(item)
    return {
        "group": item.get("group"),
        "type": item.get("type"),
        "confidence": item.get("confidence"),
        "box": box,
        "color": extract_colors(image, box=box, k=k),
        "pattern": classify_pattern(image, box=box),
        "texture": classify_texture(image, box=box),
    }


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
