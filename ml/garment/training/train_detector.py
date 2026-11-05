"""Fine-tune YOLOv8n for photos that contain more than one garment.

The single-garment API localizes with SegFormer instead. Use this when a
photo can contain several items and a box detector is worth training.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from paths import DATASETS, DETECTOR_WEIGHTS, RUNS


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune YOLOv8n for garment detection")
    parser.add_argument("--data", type=Path, default=DATASETS / "processed" / "detector" / "closette.yaml")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    args = parser.parse_args()
    if not args.data.is_file():
        raise SystemExit(f"Missing {args.data}. Run prepare.py first.")

    from ultralytics import YOLO

    model = YOLO("yolov8n.pt")
    model.train(
        data=str(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=str(RUNS),
        name="detector",
    )
    trained = RUNS / "detector" / "weights" / "best.pt"
    DETECTOR_WEIGHTS.parent.mkdir(parents=True, exist_ok=True)
    if trained.is_file():
        DETECTOR_WEIGHTS.write_bytes(trained.read_bytes())
        print(f"saved {DETECTOR_WEIGHTS}")


if __name__ == "__main__":
    main()
