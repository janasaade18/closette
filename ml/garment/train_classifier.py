"""Fine-tune ImageNet MobileNetV3-Large. The ImageNet head is replaced by the Closette types."""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms

from taxonomy import class_names


class GarmentFolder(datasets.ImageFolder):
    """Class indexes follow taxonomy.json, including types missing from one split."""

    def find_classes(self, directory: str) -> tuple[list[str], dict[str, int]]:
        names = class_names()
        return names, {name: index for index, name in enumerate(names)}

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune MobileNetV3-Large on garment type")
    parser.add_argument("--data", type=Path, default=Path("ml/garment/data/classifier"))
    parser.add_argument("--out", type=Path, default=Path("ml/garment/weights/classifier.pt"))
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--freeze-epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_dir = args.data / "train"
    val_dir = args.data / "val"
    if not train_dir.is_dir():
        raise SystemExit(f"Missing training crops at {train_dir}. Run prepare.py first.")

    expected = class_names()
    train_set = GarmentFolder(train_dir, _train_transform())
    val_set = GarmentFolder(val_dir, _eval_transform()) if val_dir.is_dir() else None

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = (
        DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=0)
        if val_set
        else None
    )

    model = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.IMAGENET1K_V1)
    in_features = model.classifier[3].in_features
    model.classifier[3] = nn.Linear(in_features, len(expected))
    model.to(device)
    _freeze_backbone(model, True)

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr)
    best_top1 = -1.0

    for epoch in range(1, args.epochs + 1):
        if epoch == args.freeze_epochs + 1:
            _freeze_backbone(model, False)
            optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr / 10)
        _run_epoch(model, train_loader, criterion, optimizer, device, train=True)
        top1 = _run_epoch(model, val_loader, criterion, optimizer, device, train=False) if val_loader else 0
        print(f"epoch {epoch}: val top-1 {top1:.3f}")
        if top1 >= best_top1:
            best_top1 = top1
            _save(model, args.out, expected, top1, epoch)

    print(f"best val top-1 {best_top1:.3f}")
    print("target 0.900: " + ("reached" if best_top1 >= 0.90 else "missed — train EfficientNet-B0 next"))


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


def _save(model, path: Path, names: list[str], top1: float, epoch: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model": model.state_dict(),
            "class_names": names,
            "top1": top1,
            "epoch": epoch,
        },
        path,
    )


if __name__ == "__main__":
    main()
