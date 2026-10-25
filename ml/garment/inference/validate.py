from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 12 * 1024 * 1024
MIN_SIDE = 32
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class InvalidImage(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def load_image(data: bytes, *, max_bytes: int = MAX_IMAGE_BYTES) -> Image.Image:
    if not data:
        raise InvalidImage("empty", "The upload is empty.")
    if len(data) > max_bytes:
        raise InvalidImage("too_large", "The image is larger than 12 MB.")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImage("corrupt", "The file is not a readable image.") from exc
    if image.format not in ALLOWED_FORMATS:
        raise InvalidImage(
            "unsupported_format",
            "Use a JPEG, PNG, or WebP photograph.",
        )
    rgb = image.convert("RGB")
    if min(rgb.size) < MIN_SIDE:
        raise InvalidImage("too_small", "The image is smaller than 32 pixels on one side.")
    return rgb
