"""Fast lighting check for wardrobe capture.

The phone can mirror these metrics on each preview frame for a red border.
The server reuses the same rules as a hard gate before classify or save.
"""

from __future__ import annotations

from PIL import Image
import numpy as np

# Tuned for flat-lay / hanger closet photos. Keep the field names stable for the app.
TOO_DARK_MEAN = 55.0
TOO_BRIGHT_MEAN = 210.0
LOW_CONTRAST_STD = 18.0
SHADOW_CLIP = 0.18
HIGHLIGHT_CLIP = 0.12
UNEVEN_REGIONAL = 38.0

GUIDANCE = {
    "too_dark": "The photo is too dark. Move closer to a window or turn on a lamp.",
    "too_bright": "The photo is blown out. Step away from direct sun or harsh overhead light.",
    "low_contrast": "The frame looks flat. Add more light so folds and color are visible.",
    "shadow_clip": "Hard shadows are clipping detail. Soften the light or fill from another side.",
    "highlight_clip": "Bright spots are washing out the fabric. Soften the light.",
    "uneven_shadow": "Light is uneven across the garment. Avoid a strong shadow on one side.",
}


def score_lighting(image: Image.Image) -> dict:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    if rgb.size == 0 or rgb.shape[0] < 8 or rgb.shape[1] < 8:
        return {
            "ok": False,
            "score": 0.0,
            "issues": ["too_dark"],
            "guidance": GUIDANCE["too_dark"],
            "metrics": {},
        }

    # Rec. 601 luma, same idea the phone can compute from preview Y.
    luma = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    mean = float(luma.mean())
    std = float(luma.std())
    shadow_frac = float((luma < 25).mean())
    highlight_frac = float((luma > 245).mean())
    uneven = _regional_uneven(luma)

    issues: list[str] = []
    if mean < TOO_DARK_MEAN:
        issues.append("too_dark")
    if mean > TOO_BRIGHT_MEAN:
        issues.append("too_bright")
    # Muddy underexposed frames, not a correctly lit solid color.
    if (
        std < LOW_CONTRAST_STD
        and mean < 110
        and "too_dark" not in issues
        and "too_bright" not in issues
    ):
        issues.append("low_contrast")
    if shadow_frac >= SHADOW_CLIP:
        issues.append("shadow_clip")
    if highlight_frac >= HIGHLIGHT_CLIP:
        issues.append("highlight_clip")
    if uneven >= UNEVEN_REGIONAL:
        issues.append("uneven_shadow")

    score = _score(mean, std, shadow_frac, highlight_frac, uneven)
    guidance = " ".join(GUIDANCE[issue] for issue in issues) if issues else (
        "Lighting looks good. Keep the garment filling the frame."
    )
    return {
        "ok": len(issues) == 0,
        "score": round(score, 4),
        "issues": issues,
        "guidance": guidance,
        "metrics": {
            "mean_luma": round(mean, 2),
            "std_luma": round(std, 2),
            "shadow_frac": round(shadow_frac, 4),
            "highlight_frac": round(highlight_frac, 4),
            "uneven": round(uneven, 2),
        },
    }


def _regional_uneven(luma: np.ndarray) -> float:
    height, width = luma.shape
    mid_y, mid_x = height // 2, width // 2
    regions = [
        luma[:mid_y, :mid_x],
        luma[:mid_y, mid_x:],
        luma[mid_y:, :mid_x],
        luma[mid_y:, mid_x:],
    ]
    means = [float(region.mean()) for region in regions if region.size]
    if len(means) < 2:
        return 0.0
    return float(max(means) - min(means))


def _score(
    mean: float,
    std: float,
    shadow_frac: float,
    highlight_frac: float,
    uneven: float,
) -> float:
    """1.0 is a well-lit flat frame. Drops with each lighting fault."""
    score = 1.0
    if mean < TOO_DARK_MEAN:
        score -= min(0.45, (TOO_DARK_MEAN - mean) / TOO_DARK_MEAN * 0.45)
    if mean > TOO_BRIGHT_MEAN:
        score -= min(0.45, (mean - TOO_BRIGHT_MEAN) / (255.0 - TOO_BRIGHT_MEAN) * 0.45)
    if std < LOW_CONTRAST_STD and mean < 110:
        score -= min(0.25, (LOW_CONTRAST_STD - std) / LOW_CONTRAST_STD * 0.25)
    score -= min(0.25, shadow_frac * 0.8)
    score -= min(0.25, highlight_frac * 1.2)
    if uneven >= UNEVEN_REGIONAL:
        score -= min(0.3, (uneven - UNEVEN_REGIONAL) / 80.0 * 0.3)
    return float(max(0.0, min(1.0, score)))
