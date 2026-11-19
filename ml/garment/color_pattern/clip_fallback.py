"""FashionCLIP zero-shot fallback for pattern/texture when MobileNet abstains.

Phone wardrobe photos often sit under the MobileNet 0.55 floor even when the
label is obvious. FashionCLIP is already on disk for garment type; reuse it
here only as a backup so the trained heads stay the primary path.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

FASHIONCLIP_DIR = Path(__file__).resolve().parents[1] / "weights" / "fashion-clip"

PATTERN_PROMPTS = (
    ("solid", "a solid color garment with no print"),
    ("striped", "a striped garment"),
    ("checked", "a checked or gingham garment"),
    ("plaid", "a plaid garment"),
    ("polka_dot", "a polka dot garment"),
    ("floral", "a floral print garment"),
    ("graphic_print", "a graphic print garment"),
    ("animal_print", "an animal print garment"),
    ("color_block", "a color block garment"),
)

TEXTURE_PROMPTS = (
    ("denim", "a denim garment"),
    ("cotton", "a cotton garment"),
    ("leather", "a leather garment"),
    ("fur", "a fur garment"),
    ("knit", "a knit sweater garment"),
    ("chiffon", "a chiffon garment"),
    ("silk", "a silk garment"),
)

MIN_PATTERN_CONFIDENCE = 0.40
MIN_PATTERN_MARGIN = 0.10
MIN_TEXTURE_CONFIDENCE = 0.42
MIN_TEXTURE_MARGIN = 0.12

_MODEL = None
_PROCESSOR = None
_DEVICE = None


def classify_pattern_clip(image: Image.Image) -> dict | None:
    return _classify(image, PATTERN_PROMPTS, MIN_PATTERN_CONFIDENCE, MIN_PATTERN_MARGIN)


def classify_texture_clip(image: Image.Image) -> dict | None:
    return _classify(image, TEXTURE_PROMPTS, MIN_TEXTURE_CONFIDENCE, MIN_TEXTURE_MARGIN)


def _classify(
    image: Image.Image,
    prompts: tuple[tuple[str, str], ...],
    min_confidence: float,
    min_margin: float,
) -> dict | None:
    model, processor, device = _load()
    if model is None or processor is None:
        return None
    import torch

    labels = [row[0] for row in prompts]
    texts = [row[1] for row in prompts]
    inputs = processor(
        text=texts,
        images=image.convert("RGB"),
        return_tensors="pt",
        padding=True,
    )
    inputs = {key: value.to(device) for key, value in inputs.items()}
    with torch.no_grad():
        output = model(**inputs)
        probabilities = output.logits_per_image.softmax(dim=-1)[0].detach().cpu()
    order = torch.argsort(probabilities, descending=True)
    top = int(order[0])
    second = int(order[1]) if len(order) > 1 else top
    confidence = float(probabilities[top])
    margin = float(probabilities[top] - probabilities[second]) if second != top else confidence
    if confidence < min_confidence or margin < min_margin:
        return {"primary": "unknown", "confidence": round(confidence, 4)}
    return {"primary": labels[top], "confidence": round(confidence, 4)}


def _load():
    global _MODEL, _PROCESSOR, _DEVICE
    if _MODEL is not None:
        return _MODEL, _PROCESSOR, _DEVICE
    if not (FASHIONCLIP_DIR / "config.json").exists():
        return None, None, None
    try:
        import torch
        from transformers import CLIPModel, CLIPProcessor
    except ImportError:
        return None, None, None

    _DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    _PROCESSOR = CLIPProcessor.from_pretrained(FASHIONCLIP_DIR, local_files_only=True)
    _MODEL = CLIPModel.from_pretrained(FASHIONCLIP_DIR, local_files_only=True)
    _MODEL.to(_DEVICE)
    _MODEL.eval()
    return _MODEL, _PROCESSOR, _DEVICE
