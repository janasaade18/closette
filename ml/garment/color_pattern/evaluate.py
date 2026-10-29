"""Held-out evaluation for the Gabor pattern head.

Images are generated here. This script scores classify_gabor, the fallback
used when weights/pattern_mobilenet.pt is absent. The photo model is scored
by finetune_pattern.py on its held-out split, not by these drawings.
"""

from __future__ import annotations

import json
from collections import defaultdict

import numpy as np
from PIL import Image, ImageDraw

from pattern import classify_gabor

LABELS = ["solid", "striped", "checked", "plaid", "polka_dot", "color_block", "unknown"]


def _solid(rng: np.random.Generator) -> Image.Image:
    color = tuple(int(channel) for channel in rng.integers(0, 255, 3))
    image = Image.new("RGB", (160, 160), color)
    pixels = np.asarray(image, dtype=np.float32)
    shade = np.linspace(0.6, 1.0, 160)[:, None, None]
    return Image.fromarray(np.clip(pixels * shade, 0, 255).astype(np.uint8))


def _stripes(rng: np.random.Generator) -> Image.Image:
    image = Image.new("RGB", (160, 160), (20, 30, 80))
    draw = ImageDraw.Draw(image)
    gap = int(rng.integers(12, 20))
    for y in range(0, 160, gap):
        draw.rectangle((0, y, 159, y + gap // 2), fill=(240, 240, 235))
    return image


def _checks() -> Image.Image:
    image = Image.new("RGB", (160, 160), (240, 240, 235))
    draw = ImageDraw.Draw(image)
    for y in range(0, 160, 16):
        for x in range(0, 160, 16):
            if ((x // 16) + (y // 16)) % 2 == 0:
                draw.rectangle((x, y, x + 15, y + 15), fill=(20, 30, 80))
    return image


def _plaid(rng: np.random.Generator) -> Image.Image:
    image = Image.new("RGB", (160, 160), (240, 240, 235))
    draw = ImageDraw.Draw(image)
    gap = int(rng.integers(14, 22))
    thickness = max(3, gap // 3)
    for start in range(0, 160, gap):
        draw.rectangle((0, start, 159, min(159, start + thickness)), fill=(20, 30, 80))
        draw.rectangle((start, 0, min(159, start + thickness), 159), fill=(20, 30, 80))
    return image


def _dots() -> Image.Image:
    image = Image.new("RGB", (160, 160), (240, 240, 235))
    draw = ImageDraw.Draw(image)
    for y in range(18, 150, 32):
        for x in range(18, 150, 32):
            draw.ellipse((x, y, x + 12, y + 12), fill=(20, 30, 80))
    return image


def _blocks() -> Image.Image:
    image = Image.new("RGB", (160, 160))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 79, 159), fill=(28, 42, 92))
    draw.rectangle((80, 0, 159, 159), fill=(245, 236, 210))
    return image


def _noise(rng: np.random.Generator) -> Image.Image:
    return Image.fromarray(rng.integers(0, 255, (160, 160, 3), dtype=np.uint8))


BUILDERS = {
    "solid": _solid,
    "striped": _stripes,
    "checked": lambda rng: _checks(),
    "plaid": _plaid,
    "polka_dot": lambda rng: _dots(),
    "color_block": lambda rng: _blocks(),
    "unknown": _noise,
}


def evaluate(per_class: int = 12) -> dict:
    rng = np.random.default_rng(7)
    matrix = {label: defaultdict(int) for label in LABELS}
    for label in LABELS:
        for _ in range(per_class):
            predicted = classify_gabor(BUILDERS[label](rng))["primary"]
            if predicted not in LABELS:
                predicted = "unknown"
            matrix[label][predicted] += 1

    report_labels = LABELS
    precision = {}
    recall = {}
    f1 = {}
    correct = 0
    total = per_class * len(LABELS)
    for label in report_labels:
        tp = matrix[label][label]
        correct += tp
        predicted_as = sum(matrix[other][label] for other in report_labels)
        precision[label] = tp / predicted_as if predicted_as else 0.0
        recall[label] = tp / per_class
        if precision[label] + recall[label] == 0:
            f1[label] = 0.0
        else:
            f1[label] = 2 * precision[label] * recall[label] / (precision[label] + recall[label])

    return {
        "split": "synthetic held-out, seed 7, not used for training",
        "accuracy": correct / total,
        "macro_f1": sum(f1.values()) / len(f1),
        "per_class": {
            label: {
                "precision": round(precision[label], 3),
                "recall": round(recall[label], 3),
                "f1": round(f1[label], 3),
            }
            for label in report_labels
        },
        "confusion": {label: dict(matrix[label]) for label in report_labels},
        "not_scored_in_v1": [
            "floral",
            "graphic_print",
            "abstract_print",
            "camouflage",
            "animal_print",
            "other",
        ],
        "limitations": [
            "Scores are on generated cloth, not phone photos.",
            "One wide stripe can fall under 0.55 and return unknown.",
            "Floral, graphic, abstract, camouflage, and animal print are not scored.",
        ],
    }


def main() -> None:
    print(json.dumps(evaluate(), indent=2))


if __name__ == "__main__":
    main()
