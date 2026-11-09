"""RGBA cutout unit tests."""

from __future__ import annotations

import unittest

import numpy as np
from PIL import Image

from quality.cutout import rgba_cutout


class CutoutTests(unittest.TestCase):
    def test_mask_sets_transparent_outside(self) -> None:
        image = Image.new("RGB", (8, 8), (20, 40, 80))
        mask = np.zeros((8, 8), dtype=np.uint8)
        mask[2:6, 2:6] = 1
        cutout = rgba_cutout(image, mask)
        pixels = np.asarray(cutout)
        self.assertEqual(cutout.mode, "RGBA")
        self.assertEqual(int(pixels[0, 0, 3]), 0)
        self.assertEqual(int(pixels[3, 3, 3]), 255)
        self.assertEqual(tuple(pixels[3, 3, :3]), (20, 40, 80))

    def test_box_fallback_when_mask_missing(self) -> None:
        image = Image.new("RGB", (10, 10), (1, 2, 3))
        cutout = rgba_cutout(image, None, box=[2, 2, 5, 5])
        pixels = np.asarray(cutout)
        self.assertEqual(int(pixels[0, 0, 3]), 0)
        self.assertEqual(int(pixels[3, 3, 3]), 255)


if __name__ == "__main__":
    unittest.main()
