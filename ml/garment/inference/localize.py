"""Garment localization from a semantic label map.

The runtime model is SegFormer-B2 fine-tuned on clothes
(mattmdjaga/segformer_b2_clothes). This module does not invent a box when
that model is absent or finds no garment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import numpy as np
from PIL import Image

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

# Checked against the checkpoint id2label before use.
EXPECTED_LABELS = {
    0: "Background",
    1: "Hat",
    2: "Hair",
    3: "Sunglasses",
    4: "Upper-clothes",
    5: "Skirt",
    6: "Pants",
    7: "Dress",
    8: "Belt",
    9: "Left-shoe",
    10: "Right-shoe",
    11: "Face",
    12: "Left-leg",
    13: "Right-leg",
    14: "Left-arm",
    15: "Right-arm",
    16: "Bag",
    17: "Scarf",
}

GARMENT_LABELS = {
    "Hat",
    "Upper-clothes",
    "Skirt",
    "Pants",
    "Dress",
    "Belt",
    "Left-shoe",
    "Right-shoe",
    "Bag",
    "Scarf",
}

SHOE_LABELS = {"Left-shoe", "Right-shoe"}

# Coarse mask labels that may agree with a Closette category.
# A skirt region is a bottom. Dress has its own mask class, so a skirt
# outline must not count as agreement with a dress prediction.
COARSE_GROUPS = {
    "Hat": {"accessories"},
    "Upper-clothes": {"tops", "outerwear"},
    "Skirt": {"bottoms"},
    "Pants": {"bottoms", "one-piece"},
    "Dress": {"one-piece"},
    "Belt": {"accessories"},
    "Left-shoe": {"footwear"},
    "Right-shoe": {"footwear"},
    "Bag": {"accessories"},
    "Scarf": {"accessories"},
}

SEGFORMER_ID = "mattmdjaga/segformer_b2_clothes"
CROP_PADDING = 0.08


@dataclass
class Localization:
    bbox: tuple[int, int, int, int]
    mask: np.ndarray
    coarse_label: str
    groups: set[str]


def localization_from_label_map(
    label_map: np.ndarray,
    *,
    min_area_ratio: float,
) -> Localization | None:
    """Largest garment class in a full-resolution label map. None if it is too small."""
    if label_map.ndim != 2:
        raise ValueError("label map must be height by width")
    height, width = label_map.shape
    total = height * width
    if total == 0:
        return None

    best_name = None
    best_count = 0
    for name in GARMENT_LABELS:
        count = int(np.isin(label_map, _ids_for(name)).sum())
        if count > best_count:
            best_name = name
            best_count = count
    if best_name is None or best_count / total < min_area_ratio:
        return None

    mask = np.isin(label_map, _ids_for(best_name))
    ys, xs = np.nonzero(mask)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return Localization(
        bbox=bbox,
        mask=mask,
        coarse_label=best_name,
        groups=set(COARSE_GROUPS[best_name]),
    )


def _ids_for(name: str) -> list[int]:
    names = SHOE_LABELS if name in SHOE_LABELS else {name}
    return [index for index, label in EXPECTED_LABELS.items() if label in names]


def padded_box(
    bbox: tuple[int, int, int, int],
    width: int,
    height: int,
    padding: float = CROP_PADDING,
) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = bbox
    pad_x = (x2 - x1) * padding
    pad_y = (y2 - y1) * padding
    return (
        int(max(0, x1 - pad_x)),
        int(max(0, y1 - pad_y)),
        int(min(width, x2 + pad_x)),
        int(min(height, y2 + pad_y)),
    )


def encode_rle(mask: np.ndarray, *, max_side: int = 384) -> dict:
    """Downscale a binary mask and run-length encode it. Counts start with background."""
    image = Image.fromarray(mask.astype(np.uint8) * 255)
    height, width = mask.shape
    scale = min(1.0, max_side / max(height, width))
    if scale < 1:
        resized = (
            int(round(width * scale)),
            int(round(height * scale)),
        )
        image = image.resize(resized, Image.Resampling.NEAREST)
    values = np.asarray(image) > 0
    flat = values.astype(np.uint8).ravel()
    counts: list[int] = []
    if flat.size == 0:
        return _mask_payload(values, height, width, [])
    current = 0
    run = 0
    if int(flat[0]) == 1:
        counts.append(0)
        current = 1
    for value in flat.tolist():
        if value == current:
            run += 1
        else:
            counts.append(run)
            current = int(value)
            run = 1
    counts.append(run)
    return _mask_payload(values, height, width, counts)


def _mask_payload(values: np.ndarray, source_height: int, source_width: int, counts: list[int]) -> dict:
    height, width = values.shape
    return {
        "encoding": "rle-row-major",
        "start_value": 0,
        "width": int(width),
        "height": int(height),
        "source_width": int(source_width),
        "source_height": int(source_height),
        "counts": counts,
    }


class SegFormerSegmenter:
    """Lazy SegFormer. The first call downloads weights into the Hugging Face cache."""

    def __init__(self, model_id: str = SEGFORMER_ID) -> None:
        self.model_id = model_id
        self.name = "segformer-b2-clothes"
        self._model = None
        self._processor = None
        self._device = None

    def segment(self, image: Image.Image) -> Localization | None:
        self._ensure()
        import torch

        working, _scale = _limit_side(image, 1024)
        inputs = self._processor(images=working, return_tensors="pt")
        inputs = {key: value.to(self._device) for key, value in inputs.items()}
        with torch.no_grad():
            logits = self._model(**inputs).logits
        upsampled = torch.nn.functional.interpolate(
            logits,
            size=working.size[::-1],
            mode="bilinear",
            align_corners=False,
        )
        label_map = upsampled.argmax(dim=1)[0].cpu().numpy()
        if working.size != image.size:
            label_image = Image.fromarray(label_map.astype(np.uint8), mode="L")
            label_image = label_image.resize(image.size, Image.Resampling.NEAREST)
            label_map = np.asarray(label_image)
        from taxonomy import load_taxonomy

        minimum = float(load_taxonomy()["policy"]["min_garment_area_ratio"])
        return localization_from_label_map(label_map, min_area_ratio=minimum)

    def _ensure(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor

        self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._processor = SegformerImageProcessor.from_pretrained(self.model_id)
        self._model = AutoModelForSemanticSegmentation.from_pretrained(self.model_id)
        labels = {int(key): value for key, value in self._model.config.id2label.items()}
        for index, name in EXPECTED_LABELS.items():
            if labels.get(index) != name:
                raise RuntimeError(
                    f"SegFormer label {index} is {labels.get(index)!r}, expected {name}"
                )
        self._model.to(self._device)
        self._model.eval()


def _limit_side(image: Image.Image, max_side: int) -> tuple[Image.Image, float]:
    width, height = image.size
    scale = min(1.0, max_side / max(width, height))
    if scale >= 1:
        return image, 1.0
    resized = image.resize((int(width * scale), int(height * scale)), Image.Resampling.BILINEAR)
    return resized, scale
