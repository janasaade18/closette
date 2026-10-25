"""Split checks. The same source photograph must not land in two splits."""

from __future__ import annotations

from PIL import Image


def average_hash(image: Image.Image, size: int = 8) -> str:
    gray = image.convert("L").resize((size, size), Image.Resampling.BOX)
    pixels = list(gray.getdata())
    average = sum(pixels) / len(pixels)
    bits = "".join("1" if pixel >= average else "0" for pixel in pixels)
    return f"{int(bits, 2):0{size * size // 4}x}"


def leaked_sources(rows: list[dict]) -> list[str]:
    seen: dict[str, str] = {}
    leaked: list[str] = []
    for row in rows:
        source = row["source_id"]
        split = row["split"]
        previous = seen.get(source)
        if previous is None:
            seen[source] = split
        elif previous != split and source not in leaked:
            leaked.append(source)
    return leaked
