"""Fabric texture from a garment crop.

The label comes from a MobileNetV3-Small head fine-tuned on DeepFashion
fabric tags (denim, cotton, leather, fur, knit, chiffon) plus silk when a
secondhand photo says silk. A missing weights file returns unknown.
"""

from __future__ import annotations

from pathlib import Path

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

# Was 0.55 — fabric heads often peaked ~0.45–0.54 on real closet photos.
MIN_CONFIDENCE = 0.42
WEIGHTS = Path(__file__).with_name("weights") / "texture_mobilenet.pt"
_MODEL = None
_TRANSFORM = None
_LABELS: tuple[str, ...] | None = None


def classify_texture(image: Image.Image, *, box: list[float] | None = None) -> dict:
    model, transform, labels = _load()
    if model is None or transform is None or labels is None:
        return {"primary": "unknown", "confidence": 0.0}
    import torch

    crop = _crop(image, box)
    batch = transform(crop).unsqueeze(0)
    with torch.no_grad():
        probabilities = torch.softmax(model(batch), dim=1)[0]
    index = int(probabilities.argmax())
    confidence = float(probabilities[index])
    label = labels[index] if index < len(labels) else "unknown"
    if label == "unknown" or confidence < MIN_CONFIDENCE:
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

    blob = torch.load(WEIGHTS, map_location="cpu", weights_only=False)
    labels = tuple(blob["labels"])
    if labels != TEXTURE_LABELS[:-1]:
        raise ValueError("texture weight labels do not match TEXTURE_LABELS")
    weights = models.MobileNet_V3_Small_Weights.DEFAULT
    model = models.mobilenet_v3_small(weights=None)
    model.classifier[3] = torch.nn.Linear(model.classifier[3].in_features, len(labels))
    model.load_state_dict(blob["state_dict"])
    model.eval()
    _MODEL = model
    _TRANSFORM = weights.transforms()
    _LABELS = labels
    return _MODEL, _TRANSFORM, _LABELS


def _crop(image: Image.Image, box: list[float] | None) -> Image.Image:
    crop = image.convert("RGB")
    if not box:
        return crop
    x1, y1, x2, y2 = (int(value) for value in box)
    return crop.crop((max(0, x1), max(0, y1), max(x2, x1 + 1), max(y2, y1 + 1)))
