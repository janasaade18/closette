"""RGBA cutout from a SegFormer clothes mask."""

from __future__ import annotations

from collections import deque

import numpy as np
from PIL import Image, ImageFilter


def rgba_cutout(
    image: Image.Image,
    mask: np.ndarray | None,
    *,
    box: list[float] | None = None,
    crop: bool = True,
    pad_ratio: float = 0.1,
) -> Image.Image:
    """Transparent outside the garment with soft, filled edges.

    Skin-like pixels that SegFormer tags as arms/legs are dropped so cutouts
    look like product photos instead of messy body fragments. The result is
    cropped tightly around the garment with a little padding.
    """
    rgb = image.convert("RGB")
    width, height = rgb.size
    rgb_array = np.asarray(rgb)

    if mask is not None:
        binary = np.asarray(mask) > 0
        if binary.shape != (height, width):
            resized = Image.fromarray(binary.astype(np.uint8) * 255)
            resized = resized.resize((width, height), Image.Resampling.BILINEAR)
            binary = np.asarray(resized) >= 128
        binary = refine_garment_mask(binary, box=box)
        binary = drop_skin_fringe(rgb_array, binary)
        alpha = soft_alpha(binary)
    elif box is not None and len(box) == 4:
        alpha = np.zeros((height, width), dtype=np.uint8)
        x1, y1, x2, y2 = (int(value) for value in box)
        x1 = max(0, min(x1, width - 1))
        y1 = max(0, min(y1, height - 1))
        x2 = max(x1 + 1, min(x2, width))
        y2 = max(y1 + 1, min(y2, height))
        alpha[y1:y2, x1:x2] = 255
        alpha = soft_alpha(alpha > 0, feather=max(2, min(height, width) // 120))
    else:
        alpha = np.full((height, width), 255, dtype=np.uint8)

    rgba = Image.fromarray(np.dstack([rgb_array, alpha]), mode="RGBA")
    if crop:
        return crop_to_alpha(rgba, pad_ratio=pad_ratio)
    return rgba


def drop_skin_fringe(rgb: np.ndarray, binary: np.ndarray) -> np.ndarray:
    """Remove bare-skin pixels while keeping fabric that was labeled as limbs."""
    if rgb.ndim != 3 or binary.shape != rgb.shape[:2] or not binary.any():
        return binary

    skin = skin_mask(rgb)
    if not skin.any():
        return binary

    # Keep a solid garment core, then only allow non-skin fringe back in.
    core = Image.fromarray(binary.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5))
    core_mask = np.asarray(core) > 0
    if not core_mask.any():
        core_mask = binary & ~skin

    kept = core_mask | (binary & ~skin)
    if not kept.any():
        return binary
    return keep_largest_component(kept)


def skin_mask(rgb: np.ndarray) -> np.ndarray:
    """Cheap RGB skin detector — enough to drop arms/legs from closet cutouts."""
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    return (
        (r > 90)
        & (g > 35)
        & (b > 15)
        & (r > g)
        & (r > b)
        & ((r - g) > 12)
        & ((r - b) > 18)
        & ((r - g) > (b // 6))
    )


def crop_to_alpha(image: Image.Image, *, pad_ratio: float = 0.1) -> Image.Image:
    """Trim empty transparency so the garment fills the frame neatly."""
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba)[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if ys.size == 0 or xs.size == 0:
        return rgba

    width, height = rgba.size
    x1, x2 = int(xs.min()), int(xs.max()) + 1
    y1, y2 = int(ys.min()), int(ys.max()) + 1
    box_w = max(1, x2 - x1)
    box_h = max(1, y2 - y1)
    pad_x = int(round(box_w * pad_ratio))
    pad_y = int(round(box_h * pad_ratio))
    left = max(0, x1 - pad_x)
    top = max(0, y1 - pad_y)
    right = min(width, x2 + pad_x)
    bottom = min(height, y2 + pad_y)
    return rgba.crop((left, top, right, bottom))


def refine_garment_mask(
    binary: np.ndarray,
    *,
    box: list[float] | None = None,
) -> np.ndarray:
    """Keep the main garment silhouette: largest blob, filled holes, gentle grow."""
    height, width = binary.shape
    if height < 3 or width < 3 or not binary.any():
        return binary

    short_side = min(height, width)
    working = binary

    # Work on a modest grid for connectivity, then map back.
    if short_side > 512:
        scale = 512 / short_side
        small = Image.fromarray(working.astype(np.uint8) * 255).resize(
            (max(8, int(round(width * scale))), max(8, int(round(height * scale)))),
            Image.Resampling.BILINEAR,
        )
        small_bin = np.asarray(small) >= 128
        small_bin = keep_largest_component(small_bin)
        small_bin = fill_holes(small_bin)
        restored = Image.fromarray(small_bin.astype(np.uint8) * 255).resize(
            (width, height),
            Image.Resampling.BILINEAR,
        )
        working = np.asarray(restored) >= 128
    else:
        working = keep_largest_component(working)
        working = fill_holes(working)

    if short_side >= 24:
        # Gentle close + tiny dilate — enough to heal cracks, not chop a box.
        close_radius = max(1, min(4, short_side // 160))
        dilate_radius = max(1, min(2, short_side // 220))
        mask_image = Image.fromarray(working.astype(np.uint8) * 255)
        for _ in range(close_radius):
            mask_image = mask_image.filter(ImageFilter.MaxFilter(3))
        for _ in range(close_radius):
            mask_image = mask_image.filter(ImageFilter.MinFilter(3))
        for _ in range(dilate_radius):
            mask_image = mask_image.filter(ImageFilter.MaxFilter(3))
        working = np.asarray(mask_image) > 0

    # Never flood-fill the whole detection box — that looked rectangular/chopped.
    if box is not None and len(box) == 4 and working.any():
        x1, y1, x2, y2 = (int(value) for value in box)
        x1 = max(0, min(x1, width - 1))
        y1 = max(0, min(y1, height - 1))
        x2 = max(x1 + 1, min(x2, width))
        y2 = max(y1 + 1, min(y2, height))
        # Clip stray pixels far outside the garment box.
        clipped = np.zeros_like(working)
        clipped[y1:y2, x1:x2] = working[y1:y2, x1:x2]
        if clipped.any():
            working = clipped

    return working


def soft_alpha(binary: np.ndarray, *, feather: int | None = None) -> np.ndarray:
    """Feather mask edges so cutouts look soft instead of jagged."""
    height, width = binary.shape
    if feather is None:
        feather = max(2, min(14, min(height, width) // 70))
    if feather < 1 or not binary.any():
        return (binary.astype(np.uint8) * 255)

    hard = Image.fromarray(binary.astype(np.uint8) * 255)
    blurred = hard.filter(ImageFilter.GaussianBlur(radius=feather))
    values = np.asarray(blurred).astype(np.float32)
    # Keep the garment core fully opaque; only the rim softens.
    values = np.clip((values - 24.0) * (255.0 / 200.0), 0, 255)
    core = Image.fromarray(binary.astype(np.uint8) * 255).filter(
        ImageFilter.MinFilter(size=max(3, (feather // 2) * 2 + 1)),
    )
    core_mask = np.asarray(core) > 0
    values[core_mask] = 255
    return values.astype(np.uint8)


def keep_largest_component(binary: np.ndarray) -> np.ndarray:
    """Drop speckles; keep the biggest garment blob."""
    height, width = binary.shape
    visited = np.zeros((height, width), dtype=bool)
    best_pixels: list[tuple[int, int]] = []

    for start_y in range(height):
        for start_x in range(width):
            if not binary[start_y, start_x] or visited[start_y, start_x]:
                continue
            stack = deque([(start_y, start_x)])
            visited[start_y, start_x] = True
            pixels = [(start_y, start_x)]
            while stack:
                y, x = stack.pop()
                for ny, nx in (
                    (y - 1, x),
                    (y + 1, x),
                    (y, x - 1),
                    (y, x + 1),
                ):
                    if (
                        0 <= ny < height
                        and 0 <= nx < width
                        and binary[ny, nx]
                        and not visited[ny, nx]
                    ):
                        visited[ny, nx] = True
                        stack.append((ny, nx))
                        pixels.append((ny, nx))
            if len(pixels) > len(best_pixels):
                best_pixels = pixels

    out = np.zeros_like(binary, dtype=bool)
    for y, x in best_pixels:
        out[y, x] = True
    return out


def fill_holes(binary: np.ndarray) -> np.ndarray:
    """Fill enclosed transparent pockets inside the garment."""
    height, width = binary.shape
    background = ~binary
    reachable = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def seed(y: int, x: int) -> None:
        if background[y, x] and not reachable[y, x]:
            reachable[y, x] = True
            queue.append((y, x))

    for x in range(width):
        seed(0, x)
        seed(height - 1, x)
    for y in range(height):
        seed(y, 0)
        seed(y, width - 1)

    while queue:
        y, x = queue.popleft()
        for ny, nx in (
            (y - 1, x),
            (y + 1, x),
            (y, x - 1),
            (y, x + 1),
        ):
            if (
                0 <= ny < height
                and 0 <= nx < width
                and background[ny, nx]
                and not reachable[ny, nx]
            ):
                reachable[ny, nx] = True
                queue.append((ny, nx))

    holes = background & ~reachable
    return binary | holes
