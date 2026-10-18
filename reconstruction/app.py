import os
import shutil
from pathlib import Path

from fastapi import FastAPI
from reconstruct import load_backend_env, prepare_dataset

app = FastAPI(title="Closette foot reconstruction worker")


@app.get("/health")
def health() -> dict:
    load_backend_env()
    configured = (os.environ.get("COLMAP_BIN") or "").strip()
    colmap = (
        configured
        if configured and Path(configured).exists()
        else shutil.which("colmap")
    )
    return {
        "ok": True,
        "colmap": bool(colmap),
        "colmap_bin": colmap,
    }


@app.post("/reconstruct")
def reconstruct(payload: dict) -> dict:
    return prepare_dataset(payload)