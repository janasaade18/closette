"""Score the classifier on the held-out crop folder. 90% top-1 is the ship bar."""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from torch.utils.data import DataLoader
from train_classifier import GarmentFolder, _eval_transform


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate garment-type top-1 accuracy")
    parser.add_argument("--data", type=Path, default=Path("ml/garment/data/classifier/val"))
    parser.add_argument("--weights", type=Path, default=Path("ml/garment/weights/classifier.pt"))
    parser.add_argument("--target", type=float, default=0.90)
    args = parser.parse_args()

    if not args.data.is_dir() or not args.weights.is_file():
        raise SystemExit("Need prepared val crops and classifier.pt")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dataset = GarmentFolder(args.data, _eval_transform())
    loader = DataLoader(dataset, batch_size=32, shuffle=False)
    model, class_names = _load_saved(args.weights, device)

    if dataset.classes != class_names:
        raise SystemExit(f"Val classes {dataset.classes} do not match checkpoint {class_names}")

    correct = 0
    total = 0
    per_class = {name: [0, 0] for name in class_names}
    model.eval()
    with torch.no_grad():
        for images, targets in loader:
            images = images.to(device)
            predictions = model(images).argmax(dim=1).cpu()
            for prediction, target in zip(predictions.tolist(), targets.tolist()):
                total += 1
                per_class[class_names[target]][1] += 1
                if prediction == target:
                    correct += 1
                    per_class[class_names[target]][0] += 1

    top1 = correct / total if total else 0.0
    print(f"top-1 {top1:.3f} on {total} images")
    for name, (hits, count) in per_class.items():
        score = hits / count if count else 0.0
        print(f"  {name}: {score:.3f} ({count})")
    print("target {:.3f}: {}".format(args.target, "reached" if top1 >= args.target else "missed"))
    if top1 < args.target:
        raise SystemExit(1)


def _load_saved(path: Path, device: torch.device):
    from torchvision import models

    checkpoint = torch.load(path, map_location=device, weights_only=False)
    names: list[str] = checkpoint["class_names"]
    model = models.mobilenet_v3_large(weights=None)
    model.classifier[3] = torch.nn.Linear(model.classifier[3].in_features, len(names))
    model.load_state_dict(checkpoint["model"])
    model.to(device)
    return model, names


if __name__ == "__main__":
    main()
