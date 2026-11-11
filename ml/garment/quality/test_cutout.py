"""RGBA cutout unit tests."""

from __future__ import annotations

import unittest

import numpy as np
from PIL import Image

from quality.cutout import (
    crop_to_alpha,
    drop_skin_fringe,
    fill_holes,
    refine_garment_mask,
    rgba_cutout,
    soft_alpha,
)


class CutoutTests(unittest.TestCase):
    def test_mask_sets_transparent_outside(self) -> None:
        image = Image.new("RGB", (8, 8), (20, 40, 80))
        mask = np.zeros((8, 8), dtype=np.uint8)
        mask[2:6, 2:6] = 1
        cutout = rgba_cutout(image, mask)
        pixels = np.asarray(cutout)
        self.assertEqual(cutout.mode, "RGBA")
        self.assertEqual(int(pixels[0, 0, 3]), 0)
        self.assertGreater(int(pixels[3, 3, 3]), 200)
        self.assertEqual(tuple(pixels[3, 3, :3]), (20, 40, 80))

    def test_box_fallback_when_mask_missing(self) -> None:
        image = Image.new("RGB", (10, 10), (1, 2, 3))
        cutout = rgba_cutout(image, None, box=[2, 2, 5, 5])
        pixels = np.asarray(cutout)
        self.assertEqual(int(pixels[0, 0, 3]), 0)
        self.assertGreater(int(pixels[3, 3, 3]), 0)

    def test_refine_fills_interior_holes(self) -> None:
        mask = np.zeros((40, 40), dtype=bool)
        mask[8:32, 8:32] = True
        mask[16:20, 16:20] = False
        refined = refine_garment_mask(mask)
        self.assertTrue(bool(refined[18, 18]))

    def test_fill_holes_keeps_outside_transparent(self) -> None:
        mask = np.zeros((30, 30), dtype=bool)
        mask[5:25, 5:25] = True
        mask[12:18, 12:18] = False
        filled = fill_holes(mask)
        self.assertTrue(bool(filled[15, 15]))
        self.assertFalse(bool(filled[0, 0]))

    def test_soft_alpha_feathers_edge(self) -> None:
        mask = np.zeros((64, 64), dtype=bool)
        mask[16:48, 16:48] = True
        alpha = soft_alpha(mask, feather=4)
        self.assertEqual(int(alpha[32, 32]), 255)
        self.assertGreater(int(alpha[16, 32]), 0)
        self.assertLess(int(alpha[14, 32]), int(alpha[18, 32]))

    def test_sparse_mask_does_not_become_rectangle(self) -> None:
        mask = np.zeros((50, 50), dtype=bool)
        mask[12:14, 12:40] = True
        refined = refine_garment_mask(mask, box=[10, 10, 40, 40])
        # Must not flood the whole box into a chopped rectangle.
        self.assertLess(float(refined[10:40, 10:40].mean()), 0.35)

    def test_crop_to_alpha_trims_empty_margins(self) -> None:
        rgba = np.zeros((40, 40, 4), dtype=np.uint8)
        rgba[10:30, 12:28, :3] = 40
        rgba[10:30, 12:28, 3] = 255
        cropped = crop_to_alpha(Image.fromarray(rgba, mode="RGBA"), pad_ratio=0.0)
        self.assertEqual(cropped.size, (16, 20))

    def test_drop_skin_fringe_keeps_dark_fabric(self) -> None:
        rgb = np.zeros((20, 20, 3), dtype=np.uint8)
        rgb[4:16, 4:16] = (20, 20, 20)
        rgb[6:10, 2:5] = (210, 160, 130)  # bare arm
        mask = np.zeros((20, 20), dtype=bool)
        mask[4:16, 4:16] = True
        mask[6:10, 2:5] = True
        cleaned = drop_skin_fringe(rgb, mask)
        self.assertTrue(bool(cleaned[10, 10]))
        self.assertFalse(bool(cleaned[8, 3]))


if __name__ == "__main__":
    unittest.main()
