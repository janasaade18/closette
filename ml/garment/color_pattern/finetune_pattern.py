"""Fine-tune MobileNetV3-Small on DeepFashion-MultiModal pattern labels.

Images live outside the git repo, in tools/datasets/deepfashion-multimodal.
Captions name the upper garment's pattern. Rows with no pattern phrase are
skipped. A held-out 15% split (by image name) is never used for training.
"""

from __future__ import annotations

import io
import os
import random
import zlib
from collections import Counter, defaultdict
from pathlib import Path

import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import models

EXTRA_ROOT = Path(
    os.environ.get(
        "CLOSETTE_DATASETS",
        Path(__file__).resolve().parents[5] / "tools" / "datasets",
    )
)
DATA_DIR = EXTRA_ROOT / "deepfashion-multimodal" / "data"
WEIGHTS = Path(__file__).with_name("weights") / "pattern_mobilenet.pt"

LABELS = (
    "solid",
    "striped",
    "checked",
    "plaid",
    "polka_dot",
    "floral",
    "graphic_print",
    "abstract_print",
    "camouflage",
    "animal_print",
    "color_block",
    "other",
)

PHRASES = (
    ("color block", "color_block"),
    ("pure color", "solid"),
    ("solid color", "solid"),
    ("stripe", "striped"),
    ("lattice", "checked"),
    ("plaid", "plaid"),
    ("floral", "floral"),
    ("graphic", "graphic_print"),
    ("polka", "polka_dot"),
    ("camouflage", "camouflage"),
    ("leopard", "animal_print"),
    ("zebra", "animal_print"),
    ("snakeskin", "animal_print"),
    ("animal", "animal_print"),
    ("abstract", "abstract_print"),
    ("complicated", "other"),
)


def pattern_from_caption(caption: str) -> str | None:
    text = caption.lower()
    first = text.find("pattern")
    window = text[: first + 20] if first >= 0 else text
    best_at = None
    best_label = None
    for phrase, label in PHRASES:
        at = window.find(phrase)
        if at >= 0 and (best_at is None or at < best_at):
            best_at = at
            best_label = label
    return best_label


def _image_bytes(value) -> bytes:
    if isinstance(value, dict) and value.get("bytes"):
        return bytes(value["bytes"])
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    raise TypeError("image column is not bytes")


class PatternShards(Dataset):
    def __init__(self, rows: list[tuple[object, int]], transform) -> None:
        self.rows = rows
        self.transform = transform

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        raw, label = self.rows[index]
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        return self.transform(image), label


def load_rows(paths: list[Path], per_class: int = 400) -> list[tuple[str, bytes, int]]:
    import pyarrow.parquet as pq

    kept: dict[str, list[tuple[str, bytes, int]]] = defaultdict(list)
    seen: Counter[str] = Counter()
    for path in paths:
        table = pq.read_table(path, columns=["img_name", "caption", "image"])
        names = table.column("img_name").to_pylist()
        captions = table.column("caption").to_pylist()
        images = table.column("image").to_pylist()
        for name, caption, image in zip(names, captions, images):
            label_name = pattern_from_caption(caption or "")
            if label_name is None:
                continue
            seen[label_name] += 1
            bucket = kept[label_name]
            if len(bucket) >= per_class:
                continue
            bucket.append((str(name), _image_bytes(image), LABELS.index(label_name)))
    rows = [item for bucket in kept.values() for item in bucket]
    print("seen", dict(seen), flush=True)
    print("kept", {name: len(kept[name]) for name in kept}, flush=True)
    return rows


def complete_shards() -> list[Path]:
    shards = sorted(DATA_DIR.glob("train-*.parquet"))
    ready = []
    for path in shards:
        # A shard still being written is not a valid parquet file.
        try:
            import pyarrow.parquet as pq

            pq.ParquetFile(path)
        except Exception:
            print(f"skip incomplete {path.name}", flush=True)
            continue
        ready.append(path)
    return ready


def split_rows(rows: list[tuple[str, bytes, int]]) -> tuple[list, list]:
    train, test = [], []
    for name, raw, label in rows:
        bucket = test if (zlib.crc32(name.encode()) % 100) < 15 else train
        bucket.append((raw, label))
    return train, test


def build_model() -> tuple[nn.Module, object]:
    weights = models.MobileNet_V3_Small_Weights.DEFAULT
    model = models.mobilenet_v3_small(weights=weights)
    for parameter in model.parameters():
        parameter.requires_grad = False
    in_features = model.classifier[3].in_features
    model.classifier[3] = nn.Linear(in_features, len(LABELS))
    return model, weights.transforms()


def run_epoch(model, loader, criterion, optimizer, device) -> float:
    model.train()
    total = 0.0
    seen = 0
    for images, labels in loader:
        images = images.to(device)
        labels = labels.to(device)
        optimizer.zero_grad()
        loss = criterion(model(images), labels)
        loss.backward()
        optimizer.step()
        total += float(loss.detach()) * len(labels)
        seen += len(labels)
    return total / max(seen, 1)


@torch.no_grad()
def evaluate(model, loader, device) -> dict:
    model.eval()
    correct = 0
    seen = 0
    per_correct = Counter()
    per_total = Counter()
    for images, labels in loader:
        images = images.to(device)
        predicted = model(images).argmax(dim=1).cpu()
        labels = labels.cpu()
        correct += int((predicted == labels).sum())
        seen += len(labels)
        for guess, truth in zip(predicted.tolist(), labels.tolist()):
            per_total[LABELS[truth]] += 1
            if guess == truth:
                per_correct[LABELS[truth]] += 1
    recall = {
        name: round(per_correct[name] / per_total[name], 3)
        for name in LABELS
        if per_total[name]
    }
    return {"accuracy": round(correct / max(seen, 1), 3), "recall": recall, "test_images": seen}


def _table_files(folder: Path) -> list[Path]:
    if not folder.exists():
        print(f"missing {folder}", flush=True)
        return []
    files = [
        path
        for path in folder.rglob("*")
        if path.suffix in {".parquet", ".arrow"} and ".cache" not in path.parts
    ]
    return sorted(files)


def _read_table(path: Path, columns: list[str]):
    import pyarrow as pa
    import pyarrow.parquet as pq

    if path.suffix == ".parquet":
        return pq.read_table(path, columns=columns)
    with pa.memory_map(str(path), "r") as source:
        try:
            table = pa.ipc.open_stream(source).read_all()
        except pa.ArrowInvalid:
            table = pa.ipc.open_file(source).read_all()
    return table.select(columns)


def load_labeled(folder: Path, column: str, mapping: dict[str, str], per_class: int = 400) -> list[tuple[str, bytes, int]]:
    kept: dict[str, list[tuple[str, bytes, int]]] = defaultdict(list)
    for path in _table_files(folder):
        try:
            table = _read_table(path, [column, "image"])
        except Exception as error:
            print(f"skip {path.name}: {error}", flush=True)
            continue
        labels = table.column(column).to_pylist()
        images = table.column("image").to_pylist()
        for index, (raw_label, image) in enumerate(zip(labels, images)):
            label_name = mapping.get(str(raw_label))
            if label_name is None:
                continue
            bucket = kept[label_name]
            if len(bucket) >= per_class:
                continue
            bucket.append((f"{path.stem}-{index}", _image_bytes(image), LABELS.index(label_name)))
    print(folder.name, {name: len(items) for name, items in kept.items()}, flush=True)
    return [item for bucket in kept.values() for item in bucket]


def load_extra() -> list[tuple[str, bytes, int]]:
    rows: list[tuple[str, bytes, int]] = []
    rows.extend(
        load_labeled(
            EXTRA_ROOT / "clothing-pattern",
            "pattern",
            {"Dot": "polka_dot"},
        )
    )
    rows.extend(
        load_labeled(
            EXTRA_ROOT / "clothing-secondhand",
            "pattern",
            {"7": "animal_print", "10": "polka_dot"},
        )
    )
    camouflage = load_labeled(
        EXTRA_ROOT / "camonet-synthetic",
        "family",
        {name: "camouflage" for name in ("digital", "blob", "desert", "multi-terrain", "woodland", "brushstroke", "arid")},
    )
    rows.extend(camouflage)
    return rows


def main() -> None:
    random.seed(11)
    torch.manual_seed(11)
    shards = complete_shards()
    if not shards:
        raise SystemExit(f"No complete parquet shards in {DATA_DIR}")
    print(f"using {len(shards)} shards", flush=True)
    named_rows = load_rows(shards)
    named_rows.extend(load_extra())
    print("rows", len(named_rows), flush=True)
    train_rows, test_rows = split_rows(named_rows)
    model, transform = build_model()
    device = torch.device("cpu")
    model.to(device)
    train_loader = DataLoader(PatternShards(train_rows, transform), batch_size=16, shuffle=True)
    test_loader = DataLoader(PatternShards(test_rows, transform), batch_size=16)
    optimizer = torch.optim.Adam(model.classifier[3].parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()
    for epoch in range(1, 3):
        loss = run_epoch(model, train_loader, criterion, optimizer, device)
        print(f"epoch {epoch} loss {loss:.4f}", flush=True)
    metrics = evaluate(model, test_loader, device)
    print("held_out", metrics, flush=True)
    WEIGHTS.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"labels": LABELS, "state_dict": model.state_dict(), "metrics": metrics}, WEIGHTS)
    print("saved", WEIGHTS, flush=True)


if __name__ == "__main__":
    main()
