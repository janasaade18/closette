"""Fit the pattern head on custom-labelled samples.

The methods report names the DeepFashion attribute set for pattern labels.
Those images are a 289,222-file research download and are not in this repo.
The report also allows custom-labelled samples. This script builds those
samples (solids, stripes, checks, plaids, dots, color blocks, and noise),
keeps them separate from evaluate.py (seed 7), and saves a linear head.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from pattern import HEAD_CLASSES, texture_features

PER_CLASS = 48
SEED = 11


def train(path: Path | None = None) -> Path:
    destination = path or Path(__file__).with_name("weights") / "pattern_head.npz"
    rng = np.random.default_rng(SEED)
    rows = []
    targets = []
    for class_index, label in enumerate(HEAD_CLASSES):
        for _ in range(PER_CLASS):
            rows.append(texture_features(_sample(label, rng)))
            targets.append(class_index)

    features = np.vstack(rows)
    mean = features.mean(axis=0)
    std = features.std(axis=0)
    scale = np.where(std < 1e-6, 1.0, std)
    standardized = (features - mean) / scale
    weights, bias = _fit_softmax(standardized, np.array(targets), len(HEAD_CLASSES))

    destination.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        destination,
        weights=weights,
        bias=bias,
        mean=mean,
        std=std,
        classes=np.array(HEAD_CLASSES),
    )
    return destination


def _fit_softmax(
    features: np.ndarray,
    targets: np.ndarray,
    class_count: int,
    steps: int = 900,
    learning_rate: float = 0.35,
) -> tuple[np.ndarray, np.ndarray]:
    count, width = features.shape
    weights = np.zeros((width, class_count))
    bias = np.zeros(class_count)
    one_hot = np.eye(class_count)[targets]
    for _ in range(steps):
        logits = features @ weights + bias
        logits -= logits.max(axis=1, keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        error = probabilities - one_hot
        weights -= learning_rate * (features.T @ error / count + 1e-3 * weights)
        bias -= learning_rate * error.mean(axis=0)
    return weights, bias


def _sample(label: str, rng: np.random.Generator) -> Image.Image:
    if label == "solid":
        return _solid(rng)
    if label == "striped":
        return _stripes(rng)
    if label == "checked":
        return _checks(rng)
    if label == "plaid":
        return _plaid(rng)
    if label == "polka_dot":
        return _dots(rng)
    if label == "color_block":
        return _blocks(rng)
    return _noise(rng)


def _colors(rng: np.random.Generator) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    first = rng.integers(0, 256, 3)
    second = rng.integers(0, 256, 3)
    if int(np.abs(first - second).sum()) < 90:
        second = 255 - first
    return tuple(int(channel) for channel in first), tuple(int(channel) for channel in second)


def _solid(rng: np.random.Generator) -> Image.Image:
    color = tuple(int(channel) for channel in rng.integers(0, 256, 3))
    image = Image.new("RGB", (160, 160), color)
    if rng.random() < 0.5:
        return image
    pixels = np.asarray(image, dtype=np.float32)
    shade = np.linspace(float(rng.uniform(0.5, 0.75)), 1.0, 160)[:, None, None]
    return Image.fromarray(np.clip(pixels * shade, 0, 255).astype(np.uint8))


def _stripes(rng: np.random.Generator) -> Image.Image:
    base, ink = _colors(rng)
    image = Image.new("RGB", (160, 160), base)
    draw = ImageDraw.Draw(image)
    gap = int(rng.integers(10, 22))
    thickness = max(4, gap // 2)
    horizontal = bool(rng.integers(0, 2))
    for start in range(0, 160, gap):
        if horizontal:
            draw.rectangle((0, start, 159, min(159, start + thickness)), fill=ink)
        else:
            draw.rectangle((start, 0, min(159, start + thickness), 159), fill=ink)
    return image


def _checks(rng: np.random.Generator) -> Image.Image:
    base, ink = _colors(rng)
    image = Image.new("RGB", (160, 160), base)
    draw = ImageDraw.Draw(image)
    cell = int(rng.integers(10, 22))
    for y in range(0, 160, cell):
        for x in range(0, 160, cell):
            if ((x // cell) + (y // cell)) % 2 == 0:
                draw.rectangle((x, y, min(159, x + cell - 1), min(159, y + cell - 1)), fill=ink)
    return image


def _plaid(rng: np.random.Generator) -> Image.Image:
    base, ink = _colors(rng)
    image = Image.new("RGB", (160, 160), base)
    draw = ImageDraw.Draw(image)
    gap = int(rng.integers(12, 24))
    thickness = max(3, gap // 3)
    for start in range(0, 160, gap):
        draw.rectangle((0, start, 159, min(159, start + thickness)), fill=ink)
        draw.rectangle((start, 0, min(159, start + thickness), 159), fill=ink)
    return image


def _dots(rng: np.random.Generator) -> Image.Image:
    base, ink = _colors(rng)
    image = Image.new("RGB", (160, 160), base)
    draw = ImageDraw.Draw(image)
    step = int(rng.integers(24, 36))
    radius = int(rng.integers(4, 7))
    for y in range(step // 2, 160, step):
        for x in range(step // 2, 160, step):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=ink)
    return image


def _blocks(rng: np.random.Generator) -> Image.Image:
    left, right = _colors(rng)
    image = Image.new("RGB", (160, 160), left)
    draw = ImageDraw.Draw(image)
    split = int(rng.integers(60, 100))
    if rng.random() < 0.5:
        draw.rectangle((split, 0, 159, 159), fill=right)
    else:
        draw.rectangle((0, split, 159, 159), fill=right)
    return image


def _noise(rng: np.random.Generator) -> Image.Image:
    return Image.fromarray(rng.integers(0, 255, (160, 160, 3), dtype=np.uint8))


if __name__ == "__main__":
    print(train())
