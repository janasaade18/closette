from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
DATASETS = PACKAGE_ROOT / "datasets"
WEIGHTS = PACKAGE_ROOT / "weights"
RUNS = PACKAGE_ROOT / "runs"
CLASSIFIER_WEIGHTS = WEIGHTS / "classifier.pt"
DETECTOR_WEIGHTS = WEIGHTS / "detector.pt"
