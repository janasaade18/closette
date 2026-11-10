"""Lighting check or full save-prep (classify + cutout).

Examples:
  python -m quality.cli photo.jpg --mode lighting
  python -m quality.cli photo.jpg --mode prepare --cutout-out cutout.png
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from quality.cutout import rgba_cutout
from quality.lighting import score_lighting

GARMENT_ROOT = Path(__file__).resolve().parents[1]
COLOR_PATTERN = GARMENT_ROOT / "color_pattern"


def main() -> None:
    parser = argparse.ArgumentParser(description="Garment lighting and save prep")
    parser.add_argument("image", type=Path)
    parser.add_argument("--mode", choices=("lighting", "prepare"), default="lighting")
    parser.add_argument("--cutout-out", type=Path, help="Where to write the RGBA PNG")
    parser.add_argument("--k", type=int, default=6)
    args = parser.parse_args()

    try:
        image = Image.open(args.image).convert("RGB")
    except (OSError, UnidentifiedImageError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}))
        raise SystemExit(1) from error

    lighting = score_lighting(image)
    if args.mode == "lighting":
        print(json.dumps(lighting, indent=2))
        return

    # Lighting is advisory only on save. Google/stock photos and imperfect
    # room light should still make it into the closet if a garment is found.
    if str(COLOR_PATTERN) not in sys.path:
        sys.path.insert(0, str(COLOR_PATTERN))
    if str(GARMENT_ROOT) not in sys.path:
        sys.path.insert(0, str(GARMENT_ROOT))

    from pipeline import _describe, _from_type_model, _item_from_type

    typed = _from_type_model(image)
    status = typed.get("status") or "unclear"
    if status == "unclear" or not typed.get("bbox") or not typed.get("subcategory"):
        print(
            json.dumps(
                {
                    "status": status,
                    "reason": typed.get("reason") or "no_garment",
                    "lighting": lighting,
                    "garments": [],
                    "cutout_path": None,
                    "model_version": typed.get("model_version"),
                    "type_model_version": typed.get("model_version"),
                },
                indent=2,
            )
        )
        return

    item = _item_from_type(typed)
    garment = _describe(image, item, args.k)
    # Prefer a fresh full-res SegFormer mask (no RLE round-trip) for cutouts.
    mask = _full_resolution_cutout_mask(image)
    if mask is None:
        mask = item.get("mask")
        mask = mask if hasattr(mask, "shape") else None
    cutout = rgba_cutout(image, mask, box=garment.get("box"))
    cutout_path = args.cutout_out
    if cutout_path is None:
        cutout_path = args.image.with_name("cutout.png")
    cutout.save(cutout_path, "PNG")

    print(
        json.dumps(
            {
                "status": "success",
                "reason": typed.get("reason"),
                "lighting": lighting,
                "garments": [garment],
                "cutout_path": str(cutout_path),
                "model_version": "color-pattern-v1",
                "type_model_version": typed.get("model_version"),
            },
            indent=2,
            default=_json_default,
        )
    )


def _full_resolution_cutout_mask(image: Image.Image):
    """Run SegFormer once more for an unscaled cutout mask, or None on failure."""
    try:
        if str(GARMENT_ROOT) not in sys.path:
            sys.path.insert(0, str(GARMENT_ROOT))
        from inference.localize import SegFormerSegmenter

        localization = SegFormerSegmenter().segment(image)
        if localization is None:
            return None
        return localization.mask
    except Exception:
        return None


def _json_default(value):
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Object of type {type(value)} is not JSON serializable")


if __name__ == "__main__":
    main()

