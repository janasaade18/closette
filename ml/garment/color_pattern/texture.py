"""Fabric texture from a garment crop.

The label comes from a MobileNetV3-Small head fine-tuned on DeepFashion
fabric tags (denim, cotton, leather, fur, knit, chiffon) plus silk when a
secondhand photo says silk. A missing weights file returns unknown.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

TEXTURE_LABELS = (
    "denim",
    "cotton",
    "leather",
    "fur",
    "knit",
    "chiffon",
    "silk",
    "other",
    "unknown",
)

MIN_CONFIDENCE = 0.50
MIN_MARGIN = 0.12
WEIGHTS = Path(__file__).with_name("weights") / "texture_mobilenet.pt"
_MODEL = None
_TRANSFORM = None
_LABELS: tuple[str, ...] | None = None


def classify_texture(
    image: Image.Image,
    *,
    box: list[float] | None = None,
    mask: np.ndarray | None = None,
) -> dict:
    model, transform, labels = _load()
    if model is None or transform is None or labels is None:
        return {"primary": "unknown", "confidence": 0.0}
    import torch

    crop = _garment_crop(image, box, mask)
    batch = transform(crop).unsqueeze(0)
    with torch.no_grad():
        probabilities = torch.softmax(model(batch), dim=1)[0].cpu().numpy()
    order = np.argsort(probabilities)[::-1]
    top = int(order[0])
    second = int(order[1]) if len(order) > 1 else top
    label = labels[top] if top < len(labels) else "unknown"
    confidence = float(probabilities[top])
    margin = float(probabilities[top] - probabilities[second]) if second != top else confidence
    if label in {"unknown", "other"} or confidence < MIN_CONFIDENCE or margin < MIN_MARGIN:
        return {"primary": "unknown", "confidence": round(confidence, 4)}
    return {"primary": label, "confidence": round(confidence, 4)}


def _load():
    global _MODEL, _TRANSFORM, _LABELS
    if _MODEL is not None and _LABELS is not None:
        return _MODEL, _TRANSFORM, _LABELS
    if not WEIGHTS.exists():
        return None, None, None
    import torch
    from torchvision import models
    from torchvision.transforms import Compose, Normalize, Resize, ToTensor

    blob = torch.load(WEIGHTS, map_location="cpu", weights_only=False)
    labels = tuple(blob["labels"])
    if labels != TEXTURE_LABELS[:-1]:
        raise ValueError("texture weight labels do not match TEXTURE_LABELS")
    model = models.mobilenet_v3_small(weights=None)
    model.classifier[3] = torch.nn.Linear(model.classifier[3].in_features, len(labels))
    model.load_state_dict(blob["state_dict"])
    model.eval()
    transform = Compose(
        [
            Resize((224, 224)),
            ToTensor(),
            Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
        ]
    )
    _MODEL = model
    _TRANSFORM = transform
    _LABELS = labels
    return _MODEL, _TRANSFORM, _LABELS


def _garment_crop(
    image: Image.Image,
    box: list[float] | None,
    mask: np.ndarray | None,
) -> Image.Image:
    crop = image.convert("RGB")
    if box:
        x1, y1, x2, y2 = (int(value) for value in box)
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = max(x1 + 1, x2)
        y2 = max(y1 + 1, y2)
        crop = crop.crop((x1, y1, x2, y2))
    else:
        x1 = y1 = 0
    if mask is None:
        return crop

    mask_arr = np.asarray(mask) > 0
    if box:
        mask_arr = mask_arr[y1:y2, x1:x2]
    if mask_arr.shape[:2] != (crop.height, crop.width):
        mask_img = Image.fromarray(mask_arr.astype(np.uint8) * 255)
        mask_img = mask_img.resize(crop.size, Image.Resampling.NEAREST)
        mask_arr = np.asarray(mask_img) > 0
    if not mask_arr.any():
        return crop
    rgb = np.asarray(crop).copy()
    rgb[~mask_arr] = 240
    return Image.fromarray(rgb)
