"""Pattern label from a garment crop.

When weights/pattern_mobilenet.pt is present, a fine-tuned MobileNetV3-Small
head labels the crop. Otherwise Gabor features and the small linear head are
used. Weak or ambiguous predictions return unknown instead of a wrong class.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

PATTERN_LABELS = (
    "solid",
    "striped",
    "checked",
    "plaid",
    "polka_dot",
    "floral",
    "graphic_print",
    "abstract_print",
    "camouflage",
    "animal_print",
    "color_block",
    "other",
    "unknown",
)

# Prefer abstaining over a wrong print. Weak softmax winners used to ship as
# floral/camo/etc after the floor was dropped to 0.42.
MIN_CONFIDENCE = 0.50
MIN_MARGIN = 0.12
UNRELIABLE = {"abstract_print", "other", "camouflage"}
GEOMETRIC = {"solid", "striped", "checked", "plaid", "polka_dot", "color_block"}
FINE_TUNE = Path(__file__).with_name("weights") / "pattern_mobilenet.pt"
_GABOR_CACHE: dict[tuple[int, float, float], np.ndarray] = {}
_HEAD: dict | None = None
_CNN = None
HEAD_CLASSES = (
    "solid",
    "striped",
    "checked",
    "plaid",
    "polka_dot",
    "color_block",
    "unknown",
)


def classify_pattern(
    image: Image.Image,
    *,
    box: list[float] | None = None,
    mask: np.ndarray | None = None,
) -> dict:
    fine_tuned = _classify_finetuned(image, box, mask)
    gabor = classify_gabor(image, box=box, mask=mask)
    if fine_tuned is None:
        return gabor

    # Prefer Gabor for clear geometric patterns when the CNN is soft/confused.
    if (
        gabor["primary"] in GEOMETRIC
        and gabor["primary"] != "unknown"
        and gabor["confidence"] >= fine_tuned["confidence"]
        and fine_tuned["confidence"] < 0.62
    ):
        return gabor
    return fine_tuned


def classify_gabor(
    image: Image.Image,
    *,
    box: list[float] | None = None,
    mask: np.ndarray | None = None,
) -> dict:
    features = texture_features(image, box=box, mask=mask)
    probabilities = _predict(features)
    return _decide(probabilities, HEAD_CLASSES)


def _classify_finetuned(
    image: Image.Image,
    box: list[float] | None,
    mask: np.ndarray | None,
) -> dict | None:
    model, transform, labels = _load_finetuned()
    if model is None or transform is None or labels is None:
        return None
    import torch

    crop = _garment_crop(image, box, mask)
    batch = transform(crop).unsqueeze(0)
    with torch.no_grad():
        probabilities = torch.softmax(model(batch), dim=1)[0].cpu().numpy()
    return _decide(probabilities, labels)


def _decide(probabilities: np.ndarray, labels: tuple[str, ...] | list[str]) -> dict:
    order = np.argsort(probabilities)[::-1]
    top = int(order[0])
    second = int(order[1]) if len(order) > 1 else top
    label = labels[top]
    confidence = float(probabilities[top])
    margin = float(probabilities[top] - probabilities[second]) if second != top else confidence

    if label == "unknown" or confidence < MIN_CONFIDENCE or margin < MIN_MARGIN:
        return {"primary": "unknown", "confidence": round(confidence, 4)}
    # Untrained / noisy classes — only keep when the model is clearly sure.
    if label in UNRELIABLE and confidence < 0.70:
        return {"primary": "unknown", "confidence": round(confidence, 4)}
    return {"primary": label, "confidence": round(confidence, 4)}


def _load_finetuned():
    global _CNN
    if _CNN is not None:
        return _CNN
    if not FINE_TUNE.exists():
        return None, None, None
    import torch
    from torchvision import models
    from torchvision.transforms import Compose, Normalize, Resize, ToTensor

    blob = torch.load(FINE_TUNE, map_location="cpu", weights_only=False)
    labels = tuple(blob["labels"])
    model = models.mobilenet_v3_small(weights=None)
    model.classifier[3] = torch.nn.Linear(model.classifier[3].in_features, len(labels))
    model.load_state_dict(blob["state_dict"])
    model.eval()
    # Letterbox-style resize (no ImageNet center-crop) so stripes/checks at the
    # edges of a garment box are not discarded.
    transform = Compose(
        [
            Resize((224, 224)),
            ToTensor(),
            Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
        ]
    )
    _CNN = (model, transform, labels)
    return _CNN


def texture_features(
    image: Image.Image,
    *,
    box: list[float] | None = None,
    mask: np.ndarray | None = None,
) -> np.ndarray:
    crop = _garment_crop(image, box, mask).resize((96, 96), Image.Resampling.NEAREST)
    rgb = np.asarray(crop, dtype=np.float32)
    gray = rgb.mean(axis=2) / 255.0
    energies = gabor_energies(gray)
    by_angle = {angle: float(np.mean(values)) for angle, values in energies.items()}
    orthogonal = min(by_angle[0.0], by_angle[90.0])
    diagonal = min(by_angle[45.0], by_angle[135.0])
    total = float(sum(by_angle.values())) + 1e-6
    dominance = max(by_angle.values()) / total
    return np.array(
        [
            np.log1p(by_angle[0.0]),
            np.log1p(by_angle[45.0]),
            np.log1p(by_angle[90.0]),
            np.log1p(by_angle[135.0]),
            np.log1p(diagonal) - np.log1p(orthogonal),
            _sign_changes(gray.mean(axis=0)) / 30.0,
            _sign_changes(gray.mean(axis=1)) / 30.0,
            _blob_count(gray) / 80.0,
            _sharp_jump(rgb) / 200.0,
            _region_split(rgb) / 200.0,
            dominance,
            np.log1p(total),
        ],
        dtype=np.float64,
    )


def _predict(features: np.ndarray) -> np.ndarray:
    head = _load_head()
    scale = np.where(head["std"] < 1e-6, 1.0, head["std"])
    logits = ((features - head["mean"]) / scale) @ head["weights"] + head["bias"]
    logits = logits - logits.max()
    exp = np.exp(logits)
    return exp / exp.sum()


def _load_head() -> dict:
    global _HEAD
    if _HEAD is not None:
        return _HEAD
    path = Path(__file__).with_name("weights") / "pattern_head.npz"
    if not path.exists():
        from fit_pattern import train

        train(path)
    loaded = np.load(path)
    _HEAD = {
        "weights": loaded["weights"],
        "bias": loaded["bias"],
        "mean": loaded["mean"],
        "std": loaded["std"],
    }
    return _HEAD


def gabor_energies(gray: np.ndarray) -> dict[float, list[float]]:
    angles = (0.0, 45.0, 90.0, 135.0)
    energies = {angle: [] for angle in angles}
    spectrum = np.fft.fft2(gray - gray.mean())
    for wavelength in (4.0, 8.0, 16.0):
        for angle in angles:
            kernel = _gabor_kernel(gray.shape, wavelength, angle)
            response = np.fft.ifft2(spectrum * kernel).real
            energies[angle].append(float(np.mean(response**2)))
    return energies


def cnn_features(image: Image.Image) -> np.ndarray | None:
    """MobileNetV3-Small penultimate vector. None when torch is not installed."""
    try:
        import torch
        from torchvision import models
    except ImportError:
        return None

    weights = models.MobileNet_V3_Small_Weights.DEFAULT
    model = models.mobilenet_v3_small(weights=weights)
    model.classifier = torch.nn.Identity()
    model.eval()
    batch = weights.transforms()(image.convert("RGB")).unsqueeze(0)
    with torch.no_grad():
        vector = model(batch).flatten().numpy()
    return vector


def _gabor_kernel(shape: tuple[int, int], wavelength: float, angle_deg: float) -> np.ndarray:
    key = (shape, wavelength, angle_deg)
    cached = _GABOR_CACHE.get(key)
    if cached is not None:
        return cached
    sigma = 0.56 * wavelength
    theta = np.deg2rad(angle_deg)
    half_y = shape[0] // 2
    half_x = shape[1] // 2
    y, x = np.mgrid[-half_y : shape[0] - half_y, -half_x : shape[1] - half_x]
    x_theta = x * np.cos(theta) + y * np.sin(theta)
    y_theta = -x * np.sin(theta) + y * np.cos(theta)
    gaussian = np.exp(-(x_theta**2 + (0.5 * y_theta) ** 2) / (2 * sigma**2))
    wave = np.cos(2 * np.pi * x_theta / wavelength)
    kernel = gaussian * wave
    kernel = kernel - kernel.mean()
    frequency = np.fft.fft2(np.fft.ifftshift(kernel))
    _GABOR_CACHE[key] = frequency
    return frequency


def _garment_crop(
    image: Image.Image,
    box: list[float] | None,
    mask: np.ndarray | None,
) -> Image.Image:
    """Crop to the box and blank non-garment pixels so background does not vote."""
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
    rgb[~mask_arr] = 240  # neutral fill outside the garment
    return Image.fromarray(rgb)


def _region_split(rgb: np.ndarray) -> float:
    left = rgb[:, : rgb.shape[1] // 2].mean()
    right = rgb[:, rgb.shape[1] // 2 :].mean()
    return float(abs(left - right))


def _sharp_jump(rgb: np.ndarray) -> float:
    columns = rgb.mean(axis=0)
    rows = rgb.mean(axis=1)
    jump_x = float(np.abs(np.diff(columns, axis=0)).mean(axis=1).max())
    jump_y = float(np.abs(np.diff(rows, axis=0)).mean(axis=1).max())
    return max(jump_x, jump_y)


def _sign_changes(signal: np.ndarray) -> int:
    centered = signal - signal.mean()
    if float(np.std(centered)) < 0.03:
        return 0
    signs = np.sign(centered)
    return int(np.sum(signs[1:] * signs[:-1] < 0))


def _blob_count(gray: np.ndarray) -> int:
    dark = gray < np.quantile(gray, 0.35)
    return _count_components(dark)


def _count_components(mask: np.ndarray) -> int:
    seen = np.zeros(mask.shape, dtype=bool)
    count = 0
    height, width = mask.shape
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            area = 0
            while stack:
                cy, cx = stack.pop()
                area += 1
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if 6 <= area <= 250:
                count += 1
    return count
