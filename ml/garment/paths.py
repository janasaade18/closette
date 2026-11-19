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
    has_weights = (folder / "model.safetensors").is_file() or (folder / "pytorch_model.bin").is_file()
    if not has_weights:
        raise FileNotFoundError(
            f"Missing {name} weight file in {folder} (expected model.safetensors). "
            f"From the repo root run: git lfs pull. "
            f"Only if LFS is empty, from ml/garment run: python prefetch.py"
        )
    return folder
