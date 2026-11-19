"""Dominant garment colors from a crop.

RGB, lighting normalization, CIELAB, K-Means with lightness down-weighted,
then a semantic color name.
"""

from __future__ import annotations

from PIL import Image

import numpy as np

from palette import SWATCHES

MODEL_VERSION = "color-pattern-v1"


def extract_colors(
    image: Image.Image,
    *,
    box: list[float] | None = None,
    mask: np.ndarray | None = None,
    k: int = 6,
    min_proportion: float = 0.06,
    sample_cap: int = 8000,
) -> dict:
    if k < 5 or k > 8:
        raise ValueError("k must be between 5 and 8")

    crop = _crop(image.convert("RGB"), box)
    pixels = np.asarray(crop, dtype=np.float32)
    if pixels.size == 0 or pixels.shape[0] < 2 or pixels.shape[1] < 2:
        raise ValueError("garment crop is empty")

    mask_crop = None
    if mask is not None:
        mask_crop = _crop_mask(mask, box, pixels.shape[0], pixels.shape[1])

    # Undo warm/cool lamp cast first, then flatten shading for clustering.
    # Name/hex come from the balanced midtones so the label tracks the fabric,
    # not the room light — without washing mid-grey into off-white.
    balanced = correct_illuminant(pixels, mask=mask_crop)
    display = balanced.reshape(-1, 3)
    flat = normalize_lighting(balanced).reshape(-1, 3)
    if mask_crop is not None:
        keep = mask_crop.reshape(-1) > 0
        if int(keep.sum()) >= k:
            flat = flat[keep]
            display = display[keep]

    if len(flat) > sample_cap:
        rng = np.random.default_rng(0)
        pick = rng.choice(len(flat), sample_cap, replace=False)
        flat = flat[pick]
        display = display[pick]

    lab = rgb_to_lab(flat / 255.0)
    features = np.column_stack([lab[:, 0] * 0.35, lab[:, 1], lab[:, 2]])
    labels, centers = kmeans(features, k)
    counts = np.bincount(labels, minlength=k).astype(np.float64)
    order = np.argsort(counts)[::-1]

    merged: dict[str, dict] = {}
    for index in order:
        proportion = float(counts[index] / counts.sum())
        if proportion < min_proportion:
            continue
        rgb = _midtone_mean(display[labels == index])
        name = semantic_name(rgb_to_lab(rgb.reshape(1, 3) / 255.0)[0])
        hex_color = _hex(rgb)
        bucket = merged.get(name)
        if bucket is None:
            merged[name] = {"name": name, "hex": hex_color, "proportion": proportion}
        else:
            bucket["proportion"] += proportion

    colors = sorted(merged.values(), key=lambda item: item["proportion"], reverse=True)
    if not colors:
        rgb = _midtone_mean(display)
        name = semantic_name(rgb_to_lab(rgb.reshape(1, 3) / 255.0)[0])
        colors = [{"name": name, "hex": _hex(rgb), "proportion": 1.0}]

    total = sum(item["proportion"] for item in colors)
    for item in colors:
        item["proportion"] = round(item["proportion"] / total, 4)
    # Fix rounding so proportions sum to 1.
    drift = round(1.0 - sum(item["proportion"] for item in colors), 4)
    colors[0]["proportion"] = round(colors[0]["proportion"] + drift, 4)

    primary = colors[0]
    secondary = [item for item in colors[1:] if item["proportion"] >= 0.08][:3]
    is_multicolor = primary["proportion"] < 0.75 or len(secondary) >= 1 and secondary[0]["proportion"] >= 0.18

    return {
        "primary": primary,
        "secondary": secondary,
        "is_multicolor": bool(is_multicolor),
    }


def correct_illuminant(
    rgb: np.ndarray,
    *,
    mask: np.ndarray | None = None,
    strength: float = 0.7,
) -> np.ndarray:
    """Pull warm/cool room light toward neutral without nuking garment hue.

    Illuminant is estimated from near-neutral pixels — preferably background
    outside the garment mask (wall/floor), else neutrals anywhere in the crop.
    No gray-world fallback on a saturated fill (that would bleach navy).
    """
    image = rgb.astype(np.float32)
    flat = image.reshape(-1, 3)
    pools: list[np.ndarray] = []
    if mask is not None:
        background = mask.reshape(-1) == 0
        if int(background.sum()) >= 64:
            pools.append(flat[background])
    pools.append(flat)

    illuminant = None
    for pool in pools:
        sample = pool
        if len(sample) > 4000:
            sample = sample[:: max(1, len(sample) // 4000)]
        lab = rgb_to_lab(sample / 255.0)
        chroma = np.hypot(lab[:, 1], lab[:, 2])
        lightness = lab[:, 0]
        neutrals = (chroma < 12.0) & (lightness > 35.0) & (lightness < 92.0)
        if int(neutrals.sum()) >= 40:
            illuminant = sample[neutrals].mean(axis=0)
            break

    if illuminant is None:
        return image

    illuminant = np.clip(illuminant, 12.0, None)
    target = float(np.mean(illuminant))
    gains = target / illuminant
    gains = 1.0 + strength * (gains - 1.0)
    gains = np.clip(gains, 0.72, 1.4)
    return np.clip(image * gains.reshape(1, 1, 3), 0, 255)


def normalize_lighting(rgb: np.ndarray) -> np.ndarray:
    """Flatten shading on a single hue. Multi-color garments are left intact so a second color is not washed out."""
    image = rgb.astype(np.float32)
    sample = image.reshape(-1, 3)
    if len(sample) > 2000:
        sample = sample[:: len(sample) // 2000]
    chroma = np.hypot(*rgb_to_lab(sample / 255.0)[:, 1:].T)
    if float(np.std(chroma)) > 6:
        return image
    luminance = image.mean(axis=2)
    radius = max(4, min(image.shape[0], image.shape[1]) // 12)
    illumination = np.clip(_box_blur(luminance, radius), 12, None)
    # Milder gain than before — hard flatten shoved mid-greys toward off-white.
    gain = np.clip(float(np.median(illumination)) / illumination, 0.65, 1.55)
    return np.clip(image * gain[..., None], 0, 255)


def _midtone_mean(rgb: np.ndarray) -> np.ndarray:
    """Average a cluster while skipping specular highlights and crushed blacks."""
    if len(rgb) == 0:
        return np.array([128.0, 128.0, 128.0], dtype=np.float32)
    lab = rgb_to_lab(rgb / 255.0)
    lightness = lab[:, 0]
    keep = (lightness > 12.0) & (lightness < 92.0)
    if int(keep.sum()) < max(8, len(rgb) // 20):
        return rgb.mean(axis=0)
    return rgb[keep].mean(axis=0)


_NEUTRAL_SWATCHES = frozenset(
    {"black", "white", "off-white", "grey", "charcoal", "cream"}
)


def semantic_name(lab: np.ndarray) -> str:
    """Low-chroma pixels stay neutral so a cool cast does not turn black into navy.

    Mid greys must stay "grey". Soft light blues (and other tinted pastels) must
    NOT — a pale blue with chroma ~12 used to fall under the neutral gate and
    become grey even when sky blue was the right name.
    """
    chroma = float(np.hypot(lab[1], lab[2]))
    a_star = float(lab[1])
    b_star = float(lab[2])
    # Clear hue at soft chroma: match chromatic swatches only (skip grey/white).
    if 8.0 <= chroma < 18.0 and (abs(a_star) >= 6.0 or abs(b_star) >= 10.0):
        return nearest_name(lab, exclude=_NEUTRAL_SWATCHES)
    if chroma < 14:
        lightness = float(lab[0])
        if lightness < 18:
            return "black"
        if lightness < 35:
            return "charcoal"
        if lightness < 75:
            return "grey"
        if lightness < 90:
            return "off-white"
        if b_star > 8:
            return "cream"
        return "white"
    return nearest_name(lab)


def nearest_name(
    lab: np.ndarray,
    *,
    exclude: frozenset[str] | None = None,
) -> str:
    best_name = "grey"
    best_distance = float("inf")
    skipped = exclude or frozenset()
    for name, rgb in SWATCHES.items():
        if name in skipped:
            continue
        anchor = rgb_to_lab(np.array(rgb, dtype=np.float32).reshape(1, 3) / 255.0)[0]
        distance = float(np.sum((lab - anchor) ** 2))
        if distance < best_distance:
            best_distance = distance
            best_name = name
    return best_name


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB float 0–1 → CIELAB. `rgb` shape (N, 3)."""
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    matrix = np.array(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ],
        dtype=np.float64,
    )
    xyz = linear @ matrix.T
    white = np.array([0.95047, 1.0, 1.08883])
    scaled = xyz / white

    def f(channel: np.ndarray) -> np.ndarray:
        delta = 6 / 29
        return np.where(channel > delta**3, np.cbrt(channel), channel / (3 * delta**2) + 4 / 29)

    f_xyz = f(scaled)
    lightness = 116 * f_xyz[:, 1] - 16
    a_star = 500 * (f_xyz[:, 0] - f_xyz[:, 1])
    b_star = 200 * (f_xyz[:, 1] - f_xyz[:, 2])
    return np.column_stack([lightness, a_star, b_star])


def kmeans(features: np.ndarray, k: int, steps: int = 20) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(0)
    # Spread seeds across the sample so a flat color still converges.
    indices = np.linspace(0, len(features) - 1, k, dtype=int)
    rng.shuffle(indices)
    centers = features[indices].astype(np.float64)
    labels = np.zeros(len(features), dtype=np.int32)
    for _ in range(steps):
        distances = ((features[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        labels = distances.argmin(axis=1).astype(np.int32)
        for index in range(k):
            members = features[labels == index]
            if len(members) == 0:
                centers[index] = features[int(rng.integers(0, len(features)))]
            else:
                centers[index] = members.mean(axis=0)
    return labels, centers


def _box_blur(channel: np.ndarray, radius: int) -> np.ndarray:
    padded = np.pad(channel, radius, mode="edge")
    integral = np.pad(padded, ((1, 0), (1, 0)), mode="constant")
    integral = np.cumsum(np.cumsum(integral, axis=0), axis=1)
    height, width = channel.shape
    y2 = np.arange(height) + 2 * radius
    x2 = np.arange(width) + 2 * radius
    total = (
        integral[y2 + 1][:, x2 + 1]
        - integral[np.arange(height)][:, x2 + 1]
        - integral[y2 + 1][:, np.arange(width)]
        + integral[np.arange(height)][:, np.arange(width)]
    )
    return total / float((2 * radius + 1) ** 2)


def _crop(image: Image.Image, box: list[float] | None) -> Image.Image:
    if not box:
        return image
    x1, y1, x2, y2 = (int(value) for value in box)
    x1 = max(0, min(x1, image.width - 1))
    y1 = max(0, min(y1, image.height - 1))
    x2 = max(x1 + 1, min(x2, image.width))
    y2 = max(y1 + 1, min(y2, image.height))
    return image.crop((x1, y1, x2, y2))


def _crop_mask(mask: np.ndarray, box: list[float] | None, height: int, width: int) -> np.ndarray:
    if box:
        x1, y1, x2, y2 = (int(value) for value in box)
        mask = mask[y1:y2, x1:x2]
    if mask.shape[0] != height or mask.shape[1] != width:
        mask_image = Image.fromarray((mask > 0).astype(np.uint8) * 255)
        mask_image = mask_image.resize((width, height))
        mask = np.asarray(mask_image) > 0
    return mask


def _hex(rgb: np.ndarray) -> str:
    channels = [int(np.clip(round(float(channel)), 0, 255)) for channel in rgb]
    return "#{:02X}{:02X}{:02X}".format(*channels)
