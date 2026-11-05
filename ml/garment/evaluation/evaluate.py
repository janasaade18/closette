"""Score held-out predictions. This does not train and does not touch the test split."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from evaluation.metrics import score_predictions
from paths import RUNS
from taxonomy import MODEL_VERSION, load_taxonomy


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate garment subcategory predictions")
    parser.add_argument("--predictions", type=Path, help="CSV with columns subcategory,prediction")
    parser.add_argument("--manifest", type=Path, help="Closet manifest to score with the live pipeline")
    parser.add_argument("--images", type=Path, help="Directory of manifest images")
    args = parser.parse_args()

    if args.predictions:
        report = _from_csv(args.predictions)
    elif args.manifest:
        if not args.images:
            parser.error("--manifest requires --images")
        report = _from_manifest(args.manifest, args.images)
    else:
        parser.error("Pass --predictions or --manifest")

    print(f"accuracy {report['accuracy']:.3f}")
    print(f"macro-F1 {report['macro_f1']:.3f} on {report['support']} images")
    for label, metrics in report["per_class"].items():
        print(
            f"  {label}: precision {metrics['precision']:.3f} "
            f"recall {metrics['recall']:.3f} support {metrics['support']}"
        )
    if "latency_ms_mean" in report:
        print(f"mean latency {report['latency_ms_mean']:.1f} ms")
    RUNS.mkdir(parents=True, exist_ok=True)
    record = {"kind": "evaluate", "model_version": MODEL_VERSION, "taxonomy_version": load_taxonomy()["version"], **report}
    (RUNS / "evaluation.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    with (RUNS / "experiments.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"kind": "evaluate", "accuracy": report["accuracy"], "macro_f1": report["macro_f1"]}) + "\n")
    print(f"wrote {RUNS / 'evaluation.json'}")


def _from_csv(path: Path) -> dict:
    y_true = []
    y_pred = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            y_true.append(row["subcategory"])
            y_pred.append(row["prediction"])
    return score_predictions(y_true, y_pred)


def _from_manifest(manifest: Path, images: Path) -> dict:
    from inference.pipeline import build_default_pipeline
    from inference.validate import load_image

    pipeline = build_default_pipeline()
    y_true = []
    y_pred = []
    latencies = []
    with manifest.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if not row.get("image") or not row.get("subcategory"):
                continue
            photo = load_image((images / row["image"]).read_bytes())
            result = pipeline.predict_image(photo, include_embedding=False, include_mask=False)
            if result["status"] == "unclear" or not result["subcategory"]:
                predicted = "unclear"
            else:
                predicted = result["subcategory"]
            y_true.append(row["subcategory"])
            y_pred.append(predicted)
            latencies.append(result["latency_ms"])
    if not y_true:
        raise SystemExit(f"No labeled rows in {manifest}")
    report = score_predictions(y_true, y_pred)
    report["latency_ms_mean"] = round(sum(latencies) / len(latencies), 1)
    return report


if __name__ == "__main__":
    main()
