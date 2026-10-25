import io
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from inference.classify import Scores
from inference.contract import REQUIRED_FIELDS
from inference.localize import encode_rle, localization_from_label_map
from inference.pipeline import GarmentPipeline, ModelError
from inference.validate import InvalidImage, load_image
from taxonomy import load_taxonomy


class FakeClassifier:
    name = "fake"
    model_id = "fake"

    def __init__(self, scores: dict[str, float], embedding: list[float] | None = None) -> None:
        self.scores = scores
        self.embedding = embedding
        self.calls = 0

    def predict(self, image: Image.Image) -> Scores:
        self.calls += 1
        return Scores(self.scores, self.embedding, self.name, self.model_id)


class FakeSegmenter:
    name = "fake-seg"

    def __init__(self, localization) -> None:
        self.localization = localization

    def segment(self, image: Image.Image):
        return self.localization


def _photo() -> Image.Image:
    return Image.new("RGB", (80, 100), (20, 40, 60))


def _mask(label_id: int) -> object:
    label_map = np.zeros((80, 100), dtype=np.uint8)
    label_map[10:70, 15:85] = label_id
    return localization_from_label_map(label_map, min_area_ratio=0.01)


class PipelineTest(unittest.TestCase):
    def test_each_category_returns_its_parent_and_a_real_box(self) -> None:
        cases = {
            "tops": ("t-shirt", 4),
            "bottoms": ("jeans", 6),
            "one-piece": ("dress", 7),
            "outerwear": ("jacket", 4),
            "footwear": ("sneakers", 9),
            "accessories": ("hat", 1),
        }
        for category, (subcategory, label_id) in cases.items():
            pipeline = GarmentPipeline(
                FakeClassifier({subcategory: 0.91, "bag": 0.02}),
                FakeSegmenter(_mask(label_id)),
            )
            result = pipeline.predict_image(_photo(), include_mask=True)
            self.assertEqual(result["status"], "success", category)
            self.assertEqual(result["category"], category)
            self.assertEqual(result["subcategory"], subcategory)
            self.assertGreaterEqual(result["confidence"], 0.35)
            self.assertEqual(len(result["bbox"]), 4)
            self.assertLess(result["bbox"][0], result["bbox"][2])
            self.assertEqual(result["mask"]["encoding"], "rle-row-major")
            self.assertTrue(set(REQUIRED_FIELDS) <= set(result))

    def test_missing_segmenter_does_not_invent_a_box_or_mask(self) -> None:
        pipeline = GarmentPipeline(FakeClassifier({"shirt": 0.8, "blouse": 0.1}))
        result = pipeline.predict_image(_photo())
        self.assertIsNone(result["bbox"])
        self.assertIsNone(result["mask"])
        self.assertEqual(result["subcategory"], "shirt")
        self.assertIsNone(result["models"]["segmenter"])

    def test_no_garment_pixels_abstains_without_calling_a_label(self) -> None:
        classifier = FakeClassifier({"dress": 0.99})
        pipeline = GarmentPipeline(classifier, FakeSegmenter(None))
        result = pipeline.predict_image(_photo())
        self.assertEqual(result["status"], "unclear")
        self.assertEqual(result["reason"], "no_garment")
        self.assertIsNone(result["category"])
        self.assertIsNone(result["bbox"])
        self.assertEqual(classifier.calls, 0)

    def test_low_confidence_and_ambiguous_pairs_ask_for_review(self) -> None:
        low = GarmentPipeline(FakeClassifier({"coat": 0.3, "jacket": 0.2}))
        self.assertEqual(low.predict_image(_photo())["reason"], "low_confidence")
        pair = GarmentPipeline(FakeClassifier({"shirt": 0.4, "blouse": 0.36}))
        reviewed = pair.predict_image(_photo())
        self.assertEqual(reviewed["status"], "review")
        self.assertEqual(reviewed["reason"], "ambiguous_pair")
        self.assertEqual(reviewed["subcategory"], "shirt")

    def test_skirt_crop_called_dress_uses_the_full_photo(self) -> None:
        class CropSensitive(FakeClassifier):
            def predict(self, image: Image.Image) -> Scores:
                self.calls += 1
                if image.size == (80, 100):
                    return Scores({"skirt": 0.79, "dress": 0.07}, None, self.name, self.model_id)
                return Scores({"dress": 0.43, "skirt": 0.22}, None, self.name, self.model_id)

        pipeline = GarmentPipeline(CropSensitive({}), FakeSegmenter(_mask(5)))
        result = pipeline.predict_image(_photo(), include_mask=False)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["category"], "bottoms")
        self.assertEqual(result["subcategory"], "skirt")
        self.assertIsNone(result["reason"])
        self.assertIsNotNone(result["bbox"])
        self.assertEqual(pipeline.classifier.calls, 2)

    def test_close_dress_and_skirt_scores_rescore_the_full_photo(self) -> None:
        class CropSensitive(FakeClassifier):
            def predict(self, image: Image.Image) -> Scores:
                self.calls += 1
                if image.size == (80, 100):
                    return Scores({"skirt": 0.62, "dress": 0.2}, None, self.name, self.model_id)
                return Scores({"dress": 0.41, "skirt": 0.38, "shorts": 0.05}, None, self.name, self.model_id)

        pipeline = GarmentPipeline(CropSensitive({}), FakeSegmenter(_mask(5)))
        result = pipeline.predict_image(_photo(), include_mask=False)
        self.assertEqual(result["subcategory"], "skirt")
        self.assertEqual(result["status"], "success")
        self.assertEqual(pipeline.classifier.calls, 2)

    def test_dress_skirt_still_close_after_rescore_asks_for_review(self) -> None:
        class CropSensitive(FakeClassifier):
            def predict(self, image: Image.Image) -> Scores:
                self.calls += 1
                if image.size == (80, 100):
                    return Scores({"dress": 0.42, "skirt": 0.39}, None, self.name, self.model_id)
                return Scores({"dress": 0.4, "skirt": 0.37}, None, self.name, self.model_id)

        pipeline = GarmentPipeline(CropSensitive({}), FakeSegmenter(_mask(5)))
        result = pipeline.predict_image(_photo(), include_mask=False)
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["reason"], "ambiguous_pair")
        self.assertIn(result["subcategory"], {"dress", "skirt"})
        self.assertEqual(pipeline.classifier.calls, 2)

    def test_tail_dress_skirt_scores_do_not_replace_the_crop(self) -> None:
        class CropSensitive(FakeClassifier):
            def predict(self, image: Image.Image) -> Scores:
                self.calls += 1
                if image.size == (80, 100):
                    return Scores({"gloves": 0.32, "skirt": 0.28, "dress": 0.05}, None, self.name, self.model_id)
                return Scores(
                    {"t-shirt": 0.25, "shirt": 0.14, "dress": 0.09, "skirt": 0.08},
                    None,
                    self.name,
                    self.model_id,
                )

        pipeline = GarmentPipeline(CropSensitive({}), FakeSegmenter(_mask(4)))
        result = pipeline.predict_image(_photo(), include_mask=False)
        self.assertEqual(result["subcategory"], "t-shirt")
        self.assertEqual(result["reason"], "low_confidence")
        self.assertEqual(pipeline.classifier.calls, 1)

    def test_unrelated_crop_confusion_does_not_force_a_full_rescore(self) -> None:
        class CropSensitive(FakeClassifier):
            def predict(self, image: Image.Image) -> Scores:
                self.calls += 1
                if image.size == (80, 100):
                    return Scores({"jumpsuit": 0.97, "tank-top": 0.01}, None, self.name, self.model_id)
                return Scores({"tank-top": 0.9, "dress": 0.04}, None, self.name, self.model_id)

        pipeline = GarmentPipeline(CropSensitive({}), FakeSegmenter(_mask(7)))
        result = pipeline.predict_image(_photo(), include_mask=False)
        self.assertEqual(result["subcategory"], "tank-top")
        self.assertEqual(result["reason"], "localization_disagrees")
        self.assertEqual(pipeline.classifier.calls, 2)

    def test_pants_crop_of_a_jumpsuit_uses_the_full_photo(self) -> None:
        class CropSensitive(FakeClassifier):
            def predict(self, image: Image.Image) -> Scores:
                self.calls += 1
                if image.size == (80, 100):
                    return Scores({"jumpsuit": 0.99, "trousers": 0.002}, None, self.name, self.model_id)
                return Scores({"trousers": 0.59, "chinos": 0.36, "jumpsuit": 0.003}, None, self.name, self.model_id)

        pipeline = GarmentPipeline(CropSensitive({}), FakeSegmenter(_mask(6)))
        result = pipeline.predict_image(_photo(), include_mask=False)
        self.assertEqual(result["subcategory"], "jumpsuit")
        self.assertEqual(result["category"], "one-piece")
        self.assertEqual(result["status"], "success")
        self.assertEqual(pipeline.classifier.calls, 2)

    def test_folded_shirt_crop_called_tank_uses_the_full_photo(self) -> None:
        class CropSensitive(FakeClassifier):
            def predict(self, image: Image.Image) -> Scores:
                self.calls += 1
                if image.size == (80, 100):
                    return Scores({"t-shirt": 0.81, "tank-top": 0.19}, None, self.name, self.model_id)
                return Scores({"tank-top": 0.98, "t-shirt": 0.02}, None, self.name, self.model_id)

        pipeline = GarmentPipeline(CropSensitive({}), FakeSegmenter(_mask(7)))
        result = pipeline.predict_image(_photo(), include_mask=False)
        self.assertEqual(result["subcategory"], "t-shirt")
        self.assertEqual(pipeline.classifier.calls, 2)

    def test_localization_disagreement_is_review_not_a_rewritten_label(self) -> None:
        pipeline = GarmentPipeline(
            FakeClassifier({"sneakers": 0.88, "boots": 0.05}),
            FakeSegmenter(_mask(6)),
        )
        result = pipeline.predict_image(_photo())
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["reason"], "localization_disagrees")
        self.assertEqual(result["subcategory"], "sneakers")
        self.assertIsNotNone(result["bbox"])

    def test_embedding_stays_null_unless_requested(self) -> None:
        pipeline = GarmentPipeline(FakeClassifier({"hat": 0.7}, embedding=[0.0, 1.0]))
        hidden = pipeline.predict_image(_photo(), include_embedding=False)
        shown = pipeline.predict_image(_photo(), include_embedding=True)
        self.assertIsNone(hidden["embedding"])
        self.assertEqual(shown["embedding"], [0.0, 1.0])

    def test_classifier_crash_is_a_model_error(self) -> None:
        class Boom(FakeClassifier):
            def predict(self, image):
                raise RuntimeError("weights")

        pipeline = GarmentPipeline(Boom({}))
        with self.assertRaises(ModelError):
            pipeline.predict_image(_photo())

    def test_tiny_mask_is_not_returned_as_a_box(self) -> None:
        label_map = np.zeros((80, 80), dtype=np.uint8)
        label_map[0, 0] = 7
        self.assertIsNone(localization_from_label_map(label_map, min_area_ratio=0.01))

    def test_rle_round_trip_covers_the_garment(self) -> None:
        label_map = np.zeros((40, 30), dtype=np.uint8)
        label_map[5:25, 4:20] = 6
        found = localization_from_label_map(label_map, min_area_ratio=0.01)
        encoded = encode_rle(found.mask, max_side=40)
        flat = []
        value = encoded["start_value"]
        for run in encoded["counts"]:
            flat.extend([value] * run)
            value = 1 - value
        restored = np.array(flat, dtype=bool).reshape(encoded["height"], encoded["width"])
        self.assertEqual(int(restored.sum()), int(found.mask.sum()))


class ValidateTest(unittest.TestCase):
    def test_png_loads_and_bad_files_are_rejected(self) -> None:
        buffer = io.BytesIO()
        Image.new("RGB", (40, 40), "white").save(buffer, format="PNG")
        self.assertEqual(load_image(buffer.getvalue()).size, (40, 40))
        with self.assertRaises(InvalidImage) as empty:
            load_image(b"")
        self.assertEqual(empty.exception.code, "empty")
        with self.assertRaises(InvalidImage) as text:
            load_image(b"not an image")
        self.assertEqual(text.exception.code, "corrupt")
        tiny = io.BytesIO()
        Image.new("RGB", (8, 8)).save(tiny, format="PNG")
        with self.assertRaises(InvalidImage) as small:
            load_image(tiny.getvalue())
        self.assertEqual(small.exception.code, "too_small")
        gif = io.BytesIO()
        Image.new("RGB", (40, 40)).save(gif, format="GIF")
        with self.assertRaises(InvalidImage) as wrong:
            load_image(gif.getvalue())
        self.assertEqual(wrong.exception.code, "unsupported_format")
        with self.assertRaises(InvalidImage) as large:
            load_image(b"x" * 50, max_bytes=10)
        self.assertEqual(large.exception.code, "too_large")


class PolicyTest(unittest.TestCase):
    def test_policy_thresholds_are_probabilities(self) -> None:
        policy = load_taxonomy()["policy"]
        self.assertLess(policy["hard_floor"], policy["abstain_below"])
        self.assertLess(policy["abstain_below"], 1)


if __name__ == "__main__":
    unittest.main()
