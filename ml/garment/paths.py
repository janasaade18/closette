from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
DATASETS = PACKAGE_ROOT / "datasets"
WEIGHTS = PACKAGE_ROOT / "weights"
RUNS = PACKAGE_ROOT / "runs"
CLASSIFIER_WEIGHTS = WEIGHTS / "classifier.pt"
DETECTOR_WEIGHTS = WEIGHTS / "detector.pt"
FASHIONCLIP_DIR = WEIGHTS / "fashion-clip"
SEGFORMER_DIR = WEIGHTS / "segformer"


def require_local_model(folder: Path, name: str) -> Path:
    if not (folder / "config.json").is_file():
        raise FileNotFoundError(
            f"Missing {name} files in {folder}. They are stored in git. Run git lfs pull."
        )
    return folder
