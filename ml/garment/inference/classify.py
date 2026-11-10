"""Subcategory scores.

Default backend is FashionCLIP zero-shot over the Closette prompts. A
MobileNetV3-Large checkpoint is used only when it covers every taxonomy id.
The FashionCLIP model card says the weights were released for research and
should be checked against this product before they are treated as final.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from paths import CLASSIFIER_WEIGHTS, FASHIONCLIP_DIR, require_local_model
from taxonomy import class_names, load_taxonomy, prompts

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

FASHIONCLIP_ID = "patrickjohncyh/fashion-clip"
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


@dataclass
class Scores:
    by_label: dict[str, float]
    embedding: list[float] | None
    model_name: str
    model_id: str


class ZeroShotClassifier:
    def __init__(self, taxonomy: dict | None = None, model_id: str = FASHIONCLIP_ID) -> None:
        self.taxonomy = taxonomy or load_taxonomy()
        self.model_id = model_id
        self.name = "fashion-clip"
        self._model = None
        self._processor = None
        self._device = None
        self._prompt_rows = prompts(self.taxonomy)

    def predict(self, image: Image.Image) -> Scores:
        self._ensure()
        import torch

        ids = [row[0] for row in self._prompt_rows]
        texts = [row[1] for row in self._prompt_rows]
        inputs = self._processor(text=texts, images=image, return_tensors="pt", padding=True)
        inputs = {key: value.to(self._device) for key, value in inputs.items()}
        with torch.no_grad():
            output = self._model(**inputs)
        probabilities = output.logits_per_image.softmax(dim=-1)[0].detach().cpu()
        scores = {ids[index]: float(probabilities[index]) for index in range(len(ids))}
        embedding = output.image_embeds[0].detach().cpu().numpy()
        return Scores(scores, _unit(embedding), self.name, self.model_id)

    def _ensure(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import CLIPModel, CLIPProcessor

        self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        folder = require_local_model(FASHIONCLIP_DIR, "FashionCLIP")
        self._processor = CLIPProcessor.from_pretrained(folder, local_files_only=True)
        self._model = CLIPModel.from_pretrained(folder, local_files_only=True)
        self._model.to(self._device)
        self._model.eval()


class MobileNetClassifier:
    def __init__(self, path: Path = CLASSIFIER_WEIGHTS) -> None:
        self.path = path
        self.name = "mobilenet_v3_large"
        self.model_id = str(path)
        self._model = None
        self._names: list[str] = []
        self._device = None

    def predict(self, image: Image.Image) -> Scores:
        self._ensure()
        import torch
        from torchvision import transforms

        transform = transforms.Compose(
            [
                transforms.Resize(256),
                transforms.CenterCrop(224),
                transforms.ToTensor(),
                transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
            ]
        )
        batch = transform(image).unsqueeze(0).to(self._device)
        with torch.no_grad():
            probabilities = torch.softmax(self._model(batch), dim=1)[0].cpu()
        scores = {
            self._names[index]: float(probabilities[index]) for index in range(len(self._names))
        }
        return Scores(scores, None, self.name, self.model_id)

    def _ensure(self) -> None:
        if self._model is not None:
            return
        import torch
        from torchvision import models

        self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        checkpoint = torch.load(self.path, map_location=self._device, weights_only=False)
        self._names = list(checkpoint["class_names"])
        backbone = checkpoint.get("backbone", "mobilenet_v3_large")
        if backbone != "mobilenet_v3_large":
            raise RuntimeError(f"Unsupported checkpoint backbone {backbone}")
        model = models.mobilenet_v3_large(weights=None)
        model.classifier[3] = torch.nn.Linear(model.classifier[3].in_features, len(self._names))
        model.load_state_dict(checkpoint["model"])
        model.to(self._device)
        model.eval()
        self._model = model


def checkpoint_covers_taxonomy(path: Path = CLASSIFIER_WEIGHTS) -> bool:
    if not path.is_file():
        return False
    try:
        import torch
    except ImportError:
        return False
    checkpoint = torch.load(path, map_location="cpu", weights_only=False)
    return set(checkpoint.get("class_names", [])) == set(class_names())


def build_classifier(choice: str = "auto"):
    taxonomy = load_taxonomy()
    if choice == "mobilenet" or (choice == "auto" and checkpoint_covers_taxonomy()):
        if not CLASSIFIER_WEIGHTS.is_file():
            raise FileNotFoundError(f"Missing classifier weights at {CLASSIFIER_WEIGHTS}")
        _require("torch")
        _require("torchvision")
        return MobileNetClassifier(CLASSIFIER_WEIGHTS)
    if choice in {"auto", "fashion-clip"}:
        _require("torch")
        _require("transformers")
        return ZeroShotClassifier(taxonomy)
    raise ValueError(f"Unknown classifier {choice}")


def _require(module: str) -> None:
    try:
        __import__(module)
    except ImportError as exc:
        raise ImportError(f"{module} is required to classify garments") from exc


def _unit(vector: np.ndarray) -> list[float]:
    norm = float(np.linalg.norm(vector))
    if norm == 0:
        scaled = vector
    else:
        scaled = vector / norm
    return [round(float(value), 6) for value in scaled.tolist()]
