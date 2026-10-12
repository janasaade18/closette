"""Fine-tune MobileNetV3-Large, or EfficientNet-B0 if that misses the 90% bar.

ImageNet supplies the starting weights. The final layer is replaced with the
subcategories that actually have crops. Zero-shot-only labels stay on FashionCLIP.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms

from paths import CLASSIFIER_WEIGHTS, DATASETS, RUNS
from taxonomy import class_names, load_taxonomy

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class GarmentFolder(datasets.ImageFolder):
    """Indexes follow taxonomy order, limited to labels that have crops."""

    def find_classes(self, directory: str) -> tuple[list[str], dict[str, int]]:
        root = Path(directory)
        names = [
            name
            for name in class_names()
            if (root / name).is_dir() and any((root / name).iterdir())
        ]
        if not names:
            raise FileNotFoundError(f"No garment crops in {directory}")
        return names, {name: index for index, name in enumerate(names)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune a garment subcategory classifier")
    parser.add_argument("--data", type=Path, default=DATASETS / "processed" / "classifier")
    parser.add_argument("--out", type=Path, default=CLASSIFIER_WEIGHTS)
    parser.add_argument("--backbone", choices=("mobilenet_v3_large", "efficientnet_b0"), default="mobilenet_v3_large")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--freeze-epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    args = parser.parse_args()

    torch.manual_seed(0)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_dir = args.data / "train"
    val_dir = args.data / "val"
    if not train_dir.is_dir():
        raise SystemExit(f"Missing training crops at {train_dir}. Run prepare.py first.")

    train_set = GarmentFolder(train_dir, _train_transform())
    val_set = GarmentFolder(val_dir, _eval_transform()) if val_dir.is_dir() else None
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = (
        DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=0) if val_set else None
    )

    model = _build(args.backbone, len(train_set.classes))
    model.to(device)
    _freeze_backbone(model, True)
    weights = _class_weights(train_set, device)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr)
    best_top1 = -1.0
    best_epoch = 0

    for epoch in range(1, args.epochs + 1):
        if epoch == args.freeze_epochs + 1:
            _freeze_backbone(model, False)
            optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr / 10)
        _run_epoch(model, train_loader, criterion, optimizer, device, train=True)
        top1 = _run_epoch(model, val_loader, criterion, optimizer, device, train=False) if val_loader else 0
        print(f"epoch {epoch}: val top-1 {top1:.3f}")
        if top1 >= best_top1:
            best_top1 = top1
            best_epoch = epoch
            _save(model, args.out, train_set.classes, args.backbone, best_top1, epoch)

    print(f"best val top-1 {best_top1:.3f}")
    print("target 0.900: " + ("reached" if best_top1 >= 0.90 else "missed — rerun with --backbone efficientnet_b0"))
    _record(args, best_top1, best_epoch)


def _build(backbone: str, count: int) -> nn.Module:
    if backbone == "mobilenet_v3_large":
        model = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.IMAGENET1K_V1)
        model.classifier[3] = nn.Linear(model.classifier[3].in_features, count)
        return model
    model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, count)
    return model


def _class_weights(dataset: GarmentFolder, device) -> torch.Tensor:
    counts = Counter(target for _, target in dataset.samples)
    total = sum(counts.values())
    weights = [total / counts[index] if counts[index] else 0.0 for index in range(len(dataset.classes))]
    return torch.tensor(weights, dtype=torch.float, device=device)


def _train_transform() -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.Resize(256),
            transforms.RandomResizedCrop(224, scale=(0.8, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )


def _eval_transform() -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )


def _freeze_backbone(model: nn.Module, frozen: bool) -> None:
    for parameter in model.features.parameters():
        parameter.requires_grad = not frozen


def _run_epoch(model, loader, criterion, optimizer, device, train: bool) -> float:
    if loader is None:
        return 0.0
    model.train(train)
    correct = 0
    total = 0
    for images, targets in loader:
        images = images.to(device)
        targets = targets.to(device)
        with torch.set_grad_enabled(train):
            logits = model(images)
            loss = criterion(logits, targets)
            if train:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
        correct += (logits.argmax(dim=1) == targets).sum().item()
        total += targets.size(0)
    return correct / total if total else 0.0


def _save(model, path: Path, names: list[str], backbone: str, top1: float, epoch: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model": model.state_dict(),
            "class_names": names,
            "backbone": backbone,
            "taxonomy_version": load_taxonomy()["version"],
            "top1": top1,
            "epoch": epoch,
        },
        path,
    )


def _record(args, top1: float, epoch: int) -> None:
    RUNS.mkdir(parents=True, exist_ok=True)
    record = {
        "kind": "train",
        "backbone": args.backbone,
        "epochs": args.epochs,
        "best_epoch": epoch,
        "val_top1": round(top1, 4),
        "taxonomy_version": load_taxonomy()["version"],
        "seed": 0,
    }
    with (RUNS / "experiments.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")


if __name__ == "__main__":
    main()
