import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from inference.api import create_app
from inference.pipeline import GarmentPipeline
from tests.test_pipeline import FakeClassifier, FakeSegmenter, _mask


class Boom:
    name = "boom"
    model_id = "boom"

    def predict(self, image):
        raise RuntimeError("broken weights")


class ApiTest(unittest.TestCase):
    def setUp(self) -> None:
        pipeline = GarmentPipeline(
            FakeClassifier({"jeans": 0.92, "trousers": 0.04}, embedding=[0.2, 0.4]),
            FakeSegmenter(_mask(6)),
        )
        self.client = TestClient(create_app(pipeline))

    def _png(self) -> bytes:
        buffer = io.BytesIO()
        Image.new("RGB", (80, 80), (10, 20, 30)).save(buffer, format="PNG")
        return buffer.getvalue()

    def test_health_and_taxonomy(self) -> None:
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["ok"])
        taxonomy = self.client.get("/v1/garments/taxonomy")
        self.assertEqual(taxonomy.json()["version"], 2)
        self.assertIn("jeans", taxonomy.json()["labels"])

    def test_classify_success_shape(self) -> None:
        response = self.client.post(
            "/v1/garments/classify",
            files={"image": ("jeans.png", self._png(), "image/png")},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["category"], "bottoms")
        self.assertEqual(body["subcategory"], "jeans")
        self.assertIsNone(body["embedding"])
        self.assertIsNotNone(body["bbox"])
        self.assertGreaterEqual(body["latency_ms"], 0)

    def test_invalid_uploads(self) -> None:
        text = self.client.post(
            "/v1/garments/classify",
            files={"image": ("notes.txt", b"hello", "text/plain")},
        )
        self.assertEqual(text.status_code, 400)
        self.assertEqual(text.json()["error"], "corrupt")
        empty = self.client.post(
            "/v1/garments/classify",
            files={"image": ("empty.png", b"", "image/png")},
        )
        self.assertEqual(empty.status_code, 400)
        self.assertEqual(empty.json()["status"], "error")

    def test_model_error_is_500(self) -> None:
        client = TestClient(create_app(GarmentPipeline(Boom())))
        response = client.post(
            "/v1/garments/classify",
            files={"image": ("jeans.png", self._png(), "image/png")},
        )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["error"], "model_error")

    def test_correction_is_stored_and_not_marked_for_training(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._check_correction(Path(tmp) / "corrections.jsonl")

    def _check_correction(self, destination: Path) -> None:
        with patch("feedback.CORRECTIONS", destination):
            response = self.client.post(
            "/v1/garments/corrections",
            json={
                "image_id": "photo-1",
                "predicted_category": "bottoms",
                "predicted_subcategory": "jeans",
                "corrected_category": "bottoms",
                "corrected_subcategory": "chinos",
                "confidence": 0.4,
                "model_version": "closet-classifier-v1",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["accepted_for_training"])
        self.assertEqual(response.json()["corrected_subcategory"], "chinos")
        rejected = self.client.post(
            "/v1/garments/corrections",
            json={"corrected_category": "footwear", "corrected_subcategory": "shoe"},
        )
        self.assertEqual(rejected.status_code, 400)


if __name__ == "__main__":
    unittest.main()
