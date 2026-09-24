"""Fine-tune YOLOv8n so a photo can contain several garments with no capture frame.

Boxes only. Segmentation comes later, with color.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune YOLOv8n for garment detection")
    parser.add_argument("--data", type=Path, default=Path("ml/garment/data/detector/closette.yaml"))
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
        project="ml/garment/runs",
        name="detector",
    )
    trained = Path("ml/garment/runs/detector/weights/best.pt")
    dest = Path("ml/garment/weights/detector.pt")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if trained.is_file():
        dest.write_bytes(trained.read_bytes())
        print(f"saved {dest}")


if __name__ == "__main__":
    main()
