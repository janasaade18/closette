"""Photo in, garment types out.

Detector (YOLOv8n) finds each item. Classifier (MobileNetV3-Large) names the crop.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from PIL import Image
from torchvision import models, transforms

from taxonomy import type_to_group

MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
EVAL_TRANSFORM = transforms.Compose(
    [
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(MEAN, STD),
    ]
)


def classify_garments(
    image_path: Path,
    detector_path: Path = Path("ml/garment/weights/detector.pt"),
    classifier_path: Path = Path("ml/garment/weights/classifier.pt"),
    min_confidence: float = 0.25,
) -> list[dict]:
    from ultralytics import YOLO

    if not detector_path.is_file() or not classifier_path.is_file():
        raise FileNotFoundError(
            "Missing weights. Train with train_detector.py and train_classifier.py first."
        )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    detector = YOLO(str(detector_path))
    classifier, class_names = _load_classifier(classifier_path, device)
    groups = type_to_group()

    image = Image.open(image_path).convert("RGB")
    detections = detector.predict(source=str(image_path), verbose=False)[0]
    results: list[dict] = []

    for box in detections.boxes:
        confidence = float(box.conf[0])
        if confidence < min_confidence:
            continue
        x1, y1, x2, y2 = (float(value) for value in box.xyxy[0].tolist())
        crop = image.crop((int(x1), int(y1), int(x2), int(y2)))
        garment_type, type_confidence = _predict_type(classifier, class_names, crop, device)
        results.append(
            {
                "group": groups[garment_type],
                "type": garment_type,
                "confidence": round(type_confidence, 4),
                "box": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            }
        )
    return results


def _load_classifier(path: Path, device: torch.device):
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    names: list[str] = checkpoint["class_names"]
    model = models.mobilenet_v3_large(weights=None)
    model.classifier[3] = torch.nn.Linear(model.classifier[3].in_features, len(names))
    model.load_state_dict(checkpoint["model"])
    model.to(device)
    model.eval()
    return model, names


def _predict_type(model, class_names: list[str], crop: Image.Image, device) -> tuple[str, float]:
    batch = EVAL_TRANSFORM(crop).unsqueeze(0).to(device)
    with torch.no_grad():
        probabilities = torch.softmax(model(batch), dim=1)[0]
    index = int(probabilities.argmax())
    return class_names[index], float(probabilities[index])


def main() -> None:
    parser = argparse.ArgumentParser(description="Classify garments in one photo")
    parser.add_argument("image", type=Path)
    parser.add_argument("--detector", type=Path, default=Path("ml/garment/weights/detector.pt"))
    parser.add_argument("--classifier", type=Path, default=Path("ml/garment/weights/classifier.pt"))
    args = parser.parse_args()
    for item in classify_garments(args.image, args.detector, args.classifier):
        print(
            f"{item['group']}/{item['type']} {item['confidence']:.2f} box={item['box']}"
        )


if __name__ == "__main__":
    main()
