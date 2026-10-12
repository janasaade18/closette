"""Build crops, detection labels, and split CSVs from DeepFashion2 and Fashionpedia.

Labels that taxonomy.json does not map are skipped. Weak mappings are kept
and marked label_quality=weak so they are not treated as clean supervision.
The same source photograph is never written into two splits.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
from collections import Counter
from pathlib import Path

from PIL import Image

from paths import DATASETS
from splits import average_hash, leaked_sources
from taxonomy import class_names, load_taxonomy, map_source_label, source_quality, type_to_group

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
MIN_SIDE = 32
BOX_PADDING = 0.08
CSV_FIELDS = (
    "image",
    "category",
    "subcategory",
    "split",
    "source",
    "source_label",
    "label_quality",
    "source_id",
    "bbox",
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare Closette garment datasets")
    parser.add_argument("--deepfashion2", type=Path, help="Extracted DeepFashion2 root")
    parser.add_argument("--fashionpedia", type=Path, help="Extracted Fashionpedia root")
    parser.add_argument("--out", type=Path, default=DATASETS)
    args = parser.parse_args()
    if not args.deepfashion2 and not args.fashionpedia:
        parser.error("Pass --deepfashion2 and/or --fashionpedia")

    taxonomy = load_taxonomy()
    samples: list[dict] = []
    if args.deepfashion2:
        samples.extend(_deepfashion2_samples(args.deepfashion2, taxonomy))
    if args.fashionpedia:
        samples.extend(_fashionpedia_samples(args.fashionpedia, taxonomy))
    if not samples:
        raise SystemExit("No mapped garments found. Check the dataset paths and annotation files.")

    samples = _drop_cross_split_duplicates(samples)
    leaked = leaked_sources(samples)
    if leaked:
        raise SystemExit(f"Source images crossed splits: {leaked[:5]}")

    groups = type_to_group(taxonomy)
    _write_classifier(samples, args.out / "processed" / "classifier", groups)
    _write_detector(samples, args.out / "processed" / "detector", class_names(taxonomy))
    _write_tables(samples, args.out, groups)
    counts = Counter(sample["label"] for sample in samples)
    print(f"Prepared {len(samples)} garments")
    for name in class_names(taxonomy):
        print(f"  {name}: {counts.get(name, 0)}")


def _deepfashion2_samples(root: Path, taxonomy: dict) -> list[dict]:
    samples: list[dict] = []
    for source_split, split in (("train", "train"), ("validation", "val")):
        image_dir = root / source_split / "image"
        anno_dir = root / source_split / "annos"
        if not anno_dir.is_dir():
            continue
        for anno_path in sorted(anno_dir.glob("*.json")):
            image_path = _find_image(image_dir, anno_path.stem)
            if image_path is None:
                continue
            with anno_path.open(encoding="utf-8") as handle:
                anno = json.load(handle)
            for key, item in anno.items():
                if not key.startswith("item") or not isinstance(item, dict):
                    continue
                raw = str(item.get("category_name", ""))
                _append_sample(samples, "deepfashion2", raw, image_path, split, _xyxy(item.get("bounding_box")), taxonomy)
    return samples


def _fashionpedia_samples(root: Path, taxonomy: dict) -> list[dict]:
    anno_dir = root / "annotations"
    catalogs = [
        ("train", "instances_attributes_train2020.json"),
        ("val", "instances_attributes_val2020.json"),
    ]
    samples: list[dict] = []
    for split, filename in catalogs:
        anno_path = anno_dir / filename
        if not anno_path.is_file():
            continue
        with anno_path.open(encoding="utf-8") as handle:
            coco = json.load(handle)
        id_to_name = {category["id"]: category["name"] for category in coco["categories"]}
        id_to_file = {image["id"]: image["file_name"] for image in coco["images"]}
        image_root = _fashionpedia_image_root(root, split)
        for ann in coco["annotations"]:
            raw = id_to_name.get(ann["category_id"], "")
            file_name = id_to_file.get(ann["image_id"])
            if not file_name:
                continue
            image_path = image_root / file_name
            if image_path.is_file():
                _append_sample(
                    samples,
                    "fashionpedia",
                    raw,
                    image_path,
                    split,
                    _xywh_to_xyxy(ann.get("bbox")),
                    taxonomy,
                )
    return samples


def _append_sample(samples, source, raw, image_path: Path, split, box, taxonomy) -> None:
    label = map_source_label(source, raw, taxonomy)
    quality = source_quality(source, raw, taxonomy)
    if label and quality and box:
        samples.append(
            {
                "split": split,
                "image": image_path,
                "label": label,
                "box": box,
                "source": source,
                "source_label": raw.strip().lower(),
                "label_quality": quality,
                "source_id": f"{source}:{image_path.resolve()}",
            }
        )


def _drop_cross_split_duplicates(samples: list[dict]) -> list[dict]:
    hash_split: dict[str, str] = {}
    kept: list[dict] = []
    dropped = 0
    cache: dict[str, str] = {}
    for sample in samples:
        source_id = sample["source_id"]
        if source_id not in cache:
            with Image.open(sample["image"]) as image:
                cache[source_id] = average_hash(image)
        digest = cache[source_id]
        previous = hash_split.get(digest)
        if previous is not None and previous != sample["split"]:
            dropped += 1
            continue
        hash_split.setdefault(digest, sample["split"])
        sample["image_hash"] = digest
        kept.append(sample)
    if dropped:
        print(f"Dropped {dropped} crops whose source photo matched another split")
    return kept


def _write_classifier(samples: list[dict], out: Path, groups: dict[str, str]) -> None:
    if out.exists():
        shutil.rmtree(out)
    for index, sample in enumerate(samples):
        dest = out / sample["split"] / sample["label"] / f"{index:07d}.jpg"
        if _save_crop(sample["image"], sample["box"], dest):
            sample["crop"] = dest
            sample["category"] = groups[sample["label"]]


def _write_detector(samples: list[dict], out: Path, names: list[str]) -> None:
    if out.exists():
        shutil.rmtree(out)
    name_to_id = {name: index for index, name in enumerate(names)}
    seen: set[tuple[str, str]] = set()
    for sample in samples:
        if "crop" not in sample:
            continue
        image_path: Path = sample["image"]
        key = (sample["split"], str(image_path))
        dest_image = out / "images" / sample["split"] / image_path.name
        dest_label = out / "labels" / sample["split"] / f"{image_path.stem}.txt"
        if key not in seen:
            dest_image.parent.mkdir(parents=True, exist_ok=True)
            dest_label.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image_path, dest_image)
            dest_label.write_text("", encoding="utf-8")
            seen.add(key)
        line = _yolo_line(name_to_id[sample["label"]], sample["box"], image_path)
        if line:
            with dest_label.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
    yaml_path = out / "closette.yaml"
    yaml_path.write_text(
        "\n".join(
            [
                f"path: {out.resolve().as_posix()}",
                "train: images/train",
                "val: images/val",
                f"nc: {len(names)}",
                "names:",
                *[f"  {index}: {name}" for index, name in enumerate(names)],
                "",
            ]
        ),
        encoding="utf-8",
    )


def _write_tables(samples: list[dict], out: Path, groups: dict[str, str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rows = {"train": [], "val": [], "test": []}
    for sample in samples:
        crop = sample.get("crop")
        if crop is None:
            continue
        rows[sample["split"]].append(
            {
                "image": Path(crop).resolve().as_posix(),
                "category": groups[sample["label"]],
                "subcategory": sample["label"],
                "split": sample["split"],
                "source": sample["source"],
                "source_label": sample["source_label"],
                "label_quality": sample["label_quality"],
                "source_id": sample["source_id"],
                "bbox": ",".join(str(int(value)) for value in sample["box"]),
            }
        )
    closet_rows = _closet_rows(out / "closet_test")
    leaked = leaked_sources(rows["train"] + rows["val"] + closet_rows)
    if leaked:
        raise SystemExit("Closet test photos overlap prepared splits")
    rows["test"] = closet_rows
    for split, items in rows.items():
        _write_csv(out / f"{split}.csv", items)
    counts = Counter((row["split"], row["subcategory"]) for row in rows["train"] + rows["val"] + rows["test"])
    summary = {
        "taxonomy_version": load_taxonomy()["version"],
        "train": len(rows["train"]),
        "val": len(rows["val"]),
        "test": len(rows["test"]),
        "counts": {f"{split}:{label}": count for (split, label), count in sorted(counts.items())},
    }
    (out / "class_counts.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def _closet_rows(closet: Path) -> list[dict]:
    manifest = closet / "manifest.csv"
    if not manifest.is_file():
        return []
    rows = []
    with manifest.open(encoding="utf-8", newline="") as handle:
        for record in csv.DictReader(handle):
            if not record.get("image") or not record.get("subcategory"):
                continue
            image = closet / "images" / record["image"]
            rows.append(
                {
                    "image": image.resolve().as_posix(),
                    "category": record["category"],
                    "subcategory": record["subcategory"],
                    "split": "test",
                    "source": "closet",
                    "source_label": record["subcategory"],
                    "label_quality": "manual",
                    "source_id": f"closet:{image.resolve()}",
                    "bbox": record.get("bbox") or "",
                }
            )
    return rows


def _write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def _fashionpedia_image_root(root: Path, split: str) -> Path:
    for candidate in (
        root / f"{split}_images",
        root / "train_images" if split == "train" else root / "val_images",
        root / "images",
        root / split,
    ):
        if candidate.is_dir():
            return candidate
    return root / "images"


def _save_crop(image_path: Path, box: tuple[float, float, float, float], dest: Path) -> bool:
    with Image.open(image_path) as image:
        image = image.convert("RGB")
        width, height = image.size
        x1, y1, x2, y2 = _padded(box, width, height)
        if x2 - x1 < MIN_SIDE or y2 - y1 < MIN_SIDE:
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        image.crop((x1, y1, x2, y2)).save(dest, quality=95)
        return True


def _yolo_line(class_id: int, box: tuple[float, float, float, float], image_path: Path) -> str | None:
    with Image.open(image_path) as image:
        width, height = image.size
    x1, y1, x2, y2 = box
    x1 = min(max(x1, 0), width)
    x2 = min(max(x2, 0), width)
    y1 = min(max(y1, 0), height)
    y2 = min(max(y2, 0), height)
    bw = x2 - x1
    bh = y2 - y1
    if bw < MIN_SIDE or bh < MIN_SIDE:
        return None
    return (
        f"{class_id} {(x1 + x2) / 2 / width:.6f} {(y1 + y2) / 2 / height:.6f} "
        f"{bw / width:.6f} {bh / height:.6f}"
    )


def _padded(box, width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    pad_x = (x2 - x1) * BOX_PADDING
    pad_y = (y2 - y1) * BOX_PADDING
    return (
        int(max(0, x1 - pad_x)),
        int(max(0, y1 - pad_y)),
        int(min(width, x2 + pad_x)),
        int(min(height, y2 + pad_y)),
    )


def _xyxy(value: object) -> tuple[float, float, float, float] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    x1, y1, x2, y2 = (float(part) for part in value)
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def _xywh_to_xyxy(value: object) -> tuple[float, float, float, float] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    x, y, w, h = (float(part) for part in value)
    if w <= 0 or h <= 0:
        return None
    return x, y, x + w, y + h


def _find_image(image_dir: Path, stem: str) -> Path | None:
    for suffix in IMAGE_SUFFIXES:
        candidate = image_dir / f"{stem}{suffix}"
        if candidate.is_file():
            return candidate
    return None


if __name__ == "__main__":
    main()
