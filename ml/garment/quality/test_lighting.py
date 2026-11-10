"""Lighting gate unit tests."""

from __future__ import annotations

import unittest

import numpy as np
from PIL import Image

from quality.lighting import score_lighting


def _solid(value: int, size: int = 128) -> Image.Image:
    return Image.new("RGB", (size, size), (value, value, value))


class LightingTests(unittest.TestCase):
    def test_good_flat_light_is_ok(self) -> None:
        image = _solid(140)
        result = score_lighting(image)
        self.assertTrue(result["ok"])
        self.assertEqual(result["issues"], [])
        self.assertGreater(result["score"], 0.7)

    def test_too_dark(self) -> None:
        result = score_lighting(_solid(20))
        self.assertFalse(result["ok"])
        self.assertIn("too_dark", result["issues"])

    def test_too_bright(self) -> None:
        result = score_lighting(_solid(245))
        self.assertFalse(result["ok"])
        self.assertIn("too_bright", result["issues"])

    def test_uneven_shadow(self) -> None:
        pixels = np.zeros((128, 128, 3), dtype=np.uint8)
        pixels[:, :64] = 40
        pixels[:, 64:] = 200
        result = score_lighting(Image.fromarray(pixels))
        self.assertFalse(result["ok"])
        self.assertIn("uneven_shadow", result["issues"])


if __name__ == "__main__":
    unittest.main()
