import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evaluation.metrics import score_predictions
from feedback import CorrectionError, store_correction
from splits import average_hash, leaked_sources


class MetricsTest(unittest.TestCase):
    def test_accuracy_and_macro_f1(self) -> None:
        report = score_predictions(["a", "a", "b"], ["a", "b", "b"])
        self.assertEqual(report["accuracy"], 0.6667)
        self.assertEqual(report["macro_f1"], 0.6667)
        self.assertEqual(report["per_class"]["a"]["support"], 2)
        self.assertEqual(report["confusion"]["a"]["b"], 1)


class SplitTest(unittest.TestCase):
    def test_same_source_cannot_cross_splits(self) -> None:
        rows = [
            {"source_id": "deepfashion2:1", "split": "train"},
            {"source_id": "deepfashion2:1", "split": "val"},
            {"source_id": "deepfashion2:2", "split": "train"},
        ]
        self.assertEqual(leaked_sources(rows), ["deepfashion2:1"])

    def test_average_hash_is_stable_for_the_same_pixels(self) -> None:
        image = Image.new("L", (32, 32), 0)
        for x in range(16):
            for y in range(32):
                image.putpixel((x, y), 255)
        flipped = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        self.assertEqual(average_hash(image), average_hash(image.copy()))
        self.assertNotEqual(average_hash(image), average_hash(flipped))


class FeedbackTest(unittest.TestCase):
    def test_category_must_match_the_subcategory_parent(self) -> None:
        with self.assertRaises(CorrectionError):
            store_correction(
                {"corrected_category": "tops", "corrected_subcategory": "jeans"},
                path=Path("runs") / "should-not-write.jsonl",
            )


if __name__ == "__main__":
    unittest.main()
