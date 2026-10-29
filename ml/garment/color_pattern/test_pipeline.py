import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from color import extract_colors
from palette import COLOR_NAMES
from pattern import PATTERN_LABELS, classify_gabor, classify_pattern
from pipeline import analyze, classify_photo


def _canvas(color: tuple[int, int, int], size: int = 160) -> Image.Image:
    return Image.new("RGB", (size, size), color)


def _stripes() -> Image.Image:
    image = _canvas((20, 32, 90))
    draw = ImageDraw.Draw(image)
    for y in range(0, 160, 16):
        draw.rectangle((0, y, 159, y + 7), fill=(245, 245, 240))
    return image


def _checks() -> Image.Image:
    image = Image.new("RGB", (160, 160), (245, 245, 240))
    draw = ImageDraw.Draw(image)
    for y in range(0, 160, 20):
        for x in range(0, 160, 20):
            if ((x // 20) + (y // 20)) % 2 == 0:
                draw.rectangle((x, y, x + 19, y + 19), fill=(20, 32, 90))
    return image


def _dots() -> Image.Image:
    image = _canvas((245, 245, 240))
    draw = ImageDraw.Draw(image)
    for y in range(16, 150, 28):
        for x in range(16, 150, 28):
            draw.ellipse((x, y, x + 10, y + 10), fill=(20, 32, 90))
    return image


def _blocks() -> Image.Image:
    image = Image.new("RGB", (160, 160))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 79, 159), fill=(28, 42, 92))
    draw.rectangle((80, 0, 159, 159), fill=(245, 236, 210))
    return image


def _shadowed(base: tuple[int, int, int]) -> Image.Image:
    image = _canvas(base)
    pixels = np.asarray(image, dtype=np.float32)
    gradient = np.linspace(0.55, 1.0, 160, dtype=np.float32)[:, None, None]
    shaded = np.clip(pixels * gradient, 0, 255).astype(np.uint8)
    return Image.fromarray(shaded)


class ColorTests(unittest.TestCase):
    def test_names_cover_the_required_palette(self) -> None:
        required = {
            "black",
            "white",
            "off-white",
            "grey",
            "charcoal",
            "red",
            "burgundy",
            "pink",
            "orange",
            "yellow",
            "mustard",
            "green",
            "olive",
            "mint",
            "blue",
            "navy",
            "sky blue",
            "purple",
            "lavender",
            "brown",
            "tan",
            "beige",
            "cream",
            "multicolor",
        }
        self.assertEqual(required, set(COLOR_NAMES))

    def test_solid_navy_is_primary_and_normalized(self) -> None:
        result = extract_colors(_shadowed((28, 42, 92)), k=6)
        self.assertEqual(result["primary"]["name"], "navy")
        self.assertTrue(result["primary"]["hex"].startswith("#"))
        total = result["primary"]["proportion"] + sum(
            item["proportion"] for item in result["secondary"]
        )
        self.assertAlmostEqual(total, 1.0, places=2)
        self.assertFalse(result["is_multicolor"])

    def test_two_blocks_are_multicolor(self) -> None:
        result = extract_colors(_blocks(), k=6)
        names = {result["primary"]["name"], *(item["name"] for item in result["secondary"])}
        self.assertIn("navy", names)
        self.assertTrue(result["is_multicolor"])
        self.assertGreaterEqual(len(result["secondary"]), 1)

    def test_box_ignores_background(self) -> None:
        image = _canvas((250, 250, 250), 200)
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 160, 160), fill=(196, 36, 42))
        result = extract_colors(image, box=[40, 40, 160, 160], k=5)
        self.assertEqual(result["primary"]["name"], "red")


class PatternTests(unittest.TestCase):
    def test_labels_match_taxonomy(self) -> None:
        self.assertIn("unknown", PATTERN_LABELS)
        self.assertIn("polka_dot", PATTERN_LABELS)

    def test_solid_stripes_checks_dots_blocks(self) -> None:
        cases = {
            "solid": _canvas((28, 42, 92)),
            "striped": _stripes(),
            "checked": _checks(),
            "polka_dot": _dots(),
            "color_block": _blocks(),
        }
        for expected, image in cases.items():
            with self.subTest(expected=expected):
                result = classify_gabor(image)
                self.assertEqual(result["primary"], expected)
                self.assertGreaterEqual(result["confidence"], 0.55)

    def test_noise_without_structure_is_unknown(self) -> None:
        rng = np.random.default_rng(1)
        noise = rng.integers(0, 255, (160, 160, 3), dtype=np.uint8)
        result = classify_gabor(Image.fromarray(noise))
        self.assertEqual(result["primary"], "unknown")


class PipelineTests(unittest.TestCase):
    def test_json_shape_uses_classifier_box(self) -> None:
        image = _canvas((250, 250, 250), 200)
        ImageDraw.Draw(image).rectangle((30, 20, 170, 180), fill=(28, 42, 92))
        payload = analyze(
            image,
            [{"type": "t-shirt", "confidence": 0.91, "box": [30, 20, 170, 180]}],
        )
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["model_version"], "color-pattern-v1")
        self.assertEqual(payload["color"]["primary"]["name"], "navy")
        self.assertIn(payload["pattern"]["primary"], PATTERN_LABELS)
        self.assertIn(classify_pattern(image)["primary"], PATTERN_LABELS)
        self.assertIn("confidence", payload["pattern"])
        self.assertIn(
            payload["texture"]["primary"],
            (
                "denim",
                "cotton",
                "leather",
                "fur",
                "knit",
                "chiffon",
                "silk",
                "other",
                "unknown",
            ),
        )
        self.assertIn("confidence", payload["texture"])

    def test_each_garment_includes_type_color_pattern_and_texture(self) -> None:
        image = _canvas((250, 250, 250), 220)
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 10, 100, 80), fill=(28, 42, 92))
        draw.rectangle((110, 100, 200, 200), fill=(180, 30, 40))
        payload = classify_photo(
            image,
            [
                {
                    "group": "top",
                    "type": "t-shirt",
                    "confidence": 0.91,
                    "box": [10, 10, 100, 80],
                },
                {
                    "group": "bottom",
                    "type": "jeans",
                    "confidence": 0.8,
                    "box": [110, 100, 200, 200],
                },
            ],
        )
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["model_version"], "color-pattern-v1")
        self.assertEqual(
            [item["type"] for item in payload["garments"]],
            ["t-shirt", "jeans"],
        )
        self.assertEqual(payload["garments"][0]["color"]["primary"]["name"], "navy")
        self.assertEqual(payload["garments"][1]["color"]["primary"]["name"], "red")
        for item in payload["garments"]:
            self.assertIn(item["pattern"]["primary"], PATTERN_LABELS)
            self.assertIn("primary", item["texture"])

    def test_missing_detector_weights_are_reported(self) -> None:
        weights = Path(__file__).resolve().parents[1] / "weights" / "detector.pt"
        if weights.is_file():
            self.skipTest("detector weights are installed")
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
            path = Path(handle.name)
        try:
            _canvas((28, 42, 92), 32).save(path, "JPEG")
            payload = classify_photo(path)
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["garments"], [])
        self.assertIn("weight", payload["error"].lower())

    def test_bad_image_does_not_invent_a_label(self) -> None:
        payload = analyze("missing-garment.jpg")
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["pattern"]["primary"], "unknown")
        self.assertEqual(payload["texture"]["primary"], "unknown")


if __name__ == "__main__":
    unittest.main()
