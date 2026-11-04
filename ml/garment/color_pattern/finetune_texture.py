"""Fine-tune a fabric-texture head on DeepFashion upper_fabric tags.

Silk is added from secondhand material text, because DeepFashion has no silk id.
NA fabric tags are skipped. A held-out 15% of names is not used for training.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision import models

from finetune_pattern import (
    DATA_DIR,
    EXTRA_ROOT,
    PatternShards,
    _image_bytes,
    _read_table,
    split_rows,
)
from texture import TEXTURE_LABELS

WEIGHTS = Path(__file__).with_name("weights") / "texture_mobilenet.pt"
TRAIN_LABELS = TEXTURE_LABELS[:-1]
DEEPFASHION = {
    "0": "denim",
    "1": "cotton",
    "2": "leather",
    "3": "fur",
    "4": "knit",
    "5": "chiffon",
    "6": "other",
}
MATERIAL_PHRASES = (
    ("denim", "denim"),
    ("leather", "leather"),
    ("silk", "silk"),
    ("chiffon", "chiffon"),
    ("knit", "knit"),
    ("fur", "fur"),
    ("cotton", "cotton"),
)


def material_label(text: str) -> str | None:
    lowered = text.lower()
    for phrase, label in MATERIAL_PHRASES:
        if phrase in lowered:
            return label
    return None


def _keep(kept: dict, seen: Counter, name: str, raw: bytes, label_name: str, per_class: int) -> None:
    seen[label_name] += 1
    bucket = kept[label_name]
    if len(bucket) >= per_class:
        return
    bucket.append((name, raw, TRAIN_LABELS.index(label_name)))


def load_deepfashion(per_class: int = 400) -> tuple[list, Counter]:
    kept: dict[str, list] = defaultdict(list)
    seen: Counter = Counter()
    for path in sorted(DATA_DIR.glob("train-*.parquet")):
        table = _read_table(path, ["img_name", "upper_fabric", "image"])
        for name, fabric, image in zip(
            table.column("img_name").to_pylist(),
            table.column("upper_fabric").to_pylist(),
            table.column("image").to_pylist(),
        ):
            label_name = DEEPFASHION.get(str(fabric))
            if label_name is None:
                continue
            _keep(kept, seen, str(name), _image_bytes(image), label_name, per_class)
    return [item for bucket in kept.values() for item in bucket], seen


def load_silk_and_materials(per_class: int = 400) -> tuple[list, Counter]:
    kept: dict[str, list] = defaultdict(list)
    seen: Counter = Counter()
    folder = EXTRA_ROOT / "clothing-secondhand"
    for path in sorted(folder.rglob("*.parquet")):
        if ".cache" in path.parts:
            continue
        table = _read_table(path, ["material", "image"])
        materials = table.column("material").to_pylist()
        images = table.column("image").to_pylist()
        for index, (material, image) in enumerate(zip(materials, images)):
            label_name = material_label(material or "")
            if label_name is None:
                continue
            _keep(kept, seen, f"{path.stem}-{index}", _image_bytes(image), label_name, per_class)
    return [item for bucket in kept.values() for item in bucket], seen


def build_model():
    weights = models.MobileNet_V3_Small_Weights.DEFAULT
    model = models.mobilenet_v3_small(weights=weights)
    for parameter in model.parameters():
        parameter.requires_grad = False
    model.classifier[3] = nn.Linear(model.classifier[3].in_features, len(TRAIN_LABELS))
    return model, weights.transforms()


def main() -> None:
    random.seed(11)
    torch.manual_seed(11)
    rows, seen = load_deepfashion()
    extra, extra_seen = load_silk_and_materials()
    seen.update(extra_seen)
    have = Counter(TRAIN_LABELS[label] for _, _, label in rows)
    for name, raw, label in extra:
        label_name = TRAIN_LABELS[label]
        if have[label_name] >= 400:
            continue
        rows.append((name, raw, label))
        have[label_name] += 1
    print("seen", dict(seen), flush=True)
    print("kept", dict(have), flush=True)
    train_rows, test_rows = split_rows(rows)
    model, transform = build_model()
    device = torch.device("cpu")
    model.to(device)
    train_loader = DataLoader(PatternShards(train_rows, transform), batch_size=16, shuffle=True)
    test_loader = DataLoader(PatternShards(test_rows, transform), batch_size=16)
    optimizer = torch.optim.Adam(model.classifier[3].parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()
    for epoch in range(1, 3):
        model.train()
        total = 0.0
        count = 0
        for images, labels in train_loader:
            images = images.to(device)
            labels = labels.to(device)
            optimizer.zero_grad()
            loss = criterion(model(images), labels)
            loss.backward()
            optimizer.step()
            total += float(loss.detach()) * len(labels)
            count += len(labels)
        print(f"epoch {epoch} loss {total / max(count, 1):.4f}", flush=True)
    model.eval()
    correct = 0
    counted = 0
    with torch.no_grad():
        for images, labels in test_loader:
            predicted = model(images.to(device)).argmax(dim=1).cpu()
            correct += int((predicted == labels).sum())
            counted += len(labels)
    accuracy = round(correct / max(counted, 1), 3)
    print("held_out_accuracy", accuracy, "test_images", counted, flush=True)
    WEIGHTS.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {"labels": TRAIN_LABELS, "state_dict": model.state_dict(), "accuracy": accuracy},
        WEIGHTS,
    )
    print("saved", WEIGHTS, flush=True)


if __name__ == "__main__":
    main()
