"""RGBA cutout from a SegFormer clothes mask."""

from __future__ import annotations

import numpy as np
from PIL import Image


def rgba_cutout(
    image: Image.Image,
    mask: np.ndarray | None,
    *,
    box: list[float] | None = None,
) -> Image.Image:
    """Transparent outside the garment. Falls back to the box when no mask exists."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    alpha = np.zeros((height, width), dtype=np.uint8)

    if mask is not None:
        binary = np.asarray(mask) > 0
        if binary.shape != (height, width):
            resized = Image.fromarray(binary.astype(np.uint8) * 255)
            resized = resized.resize((width, height), Image.Resampling.NEAREST)
            binary = np.asarray(resized) > 0
        alpha[binary] = 255
    elif box is not None and len(box) == 4:
        x1, y1, x2, y2 = (int(value) for value in box)
        x1 = max(0, min(x1, width - 1))
        y1 = max(0, min(y1, height - 1))
        x2 = max(x1 + 1, min(x2, width))
        y2 = max(y1 + 1, min(y2, height))
        alpha[y1:y2, x1:x2] = 255
    else:
        alpha[:, :] = 255

    rgba = np.dstack([np.asarray(rgb), alpha])
    return Image.fromarray(rgba, mode="RGBA")
