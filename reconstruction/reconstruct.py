"""Server-side foot reconstruction.

Downloads the accepted frames, runs COLMAP sparse reconstruction when the
COLMAP binary is installed, and uploads foot.obj to Supabase Storage.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

WORK_ROOT = Path(__file__).resolve().parent / "work"
ENV_PATH = Path(__file__).resolve().parents[1] / ".env"


def prepare_dataset(payload: dict) -> dict:
    scan_id = payload["scan_id"]
    work_dir = WORK_ROOT / scan_id
    images_dir = work_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for frame in payload.get("frames", []):
        url = frame.get("url")
        if not url:
            continue
        index = int(frame.get("index", len(saved)))
        view = frame.get("view", "unknown")
        dest = images_dir / f"{index:04d}_{view}.jpg"
        with urlopen(url) as response, dest.open("wb") as handle:
            handle.write(response.read())
        saved.append(
            {
                "index": index,
                "view": view,
                "path": str(dest),
                "pose": frame.get("pose"),
                "sharpness": frame.get("sharpness"),
            }
        )

    result = reconstruct_sparse(work_dir, len(saved))
    manifest = {
        "scan_id": scan_id,
        "foot_side": payload.get("foot_side"),
        "device": payload.get("device"),
        "camera_intrinsics": payload.get("camera_intrinsics"),
        "camera_poses": [
            {"index": frame["index"], "pose": frame.get("pose")}
            for frame in payload.get("frames", [])
            if frame.get("pose")
        ],
        "scale_reference": payload.get("scale_reference"),
        "segmentation_masks": [],
        "landmarks": [],
        "frames": saved,
        "reconstruction": result,
    }
    (work_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )

    obj_url = None
    obj_path = result.get("obj_path")
    status = result["status"]
    message = result["message"]
    if obj_path and status == "ready":
        obj_url = upload_object(Path(obj_path), f"{scan_id}/reconstruction/foot.obj")
        if not obj_url:
            status = "failed"
            message = "COLMAP wrote foot.obj but the upload to Supabase failed."

    return {
        "status": status,
        "work_dir": str(work_dir),
        "glb_url": None,
        "obj_url": obj_url,
        "message": message,
        "frame_count": len(saved),
        "point_count": result.get("point_count", 0),
    }


def colmap_command(binary: str, args: list[str]) -> list[str]:
    if binary.lower().endswith(".bat"):
        return ["cmd", "/c", binary, *args]
    return [binary, *args]


def reconstruct_sparse(work_dir: Path, frame_count: int) -> dict:
    load_backend_env()
    if frame_count < 2:
        return {
            "status": "failed",
            "message": "Need at least 2 frames for reconstruction.",
            "obj_path": None,
            "point_count": 0,
        }

    configured = (os.environ.get("COLMAP_BIN") or "").strip()
    colmap = configured if configured and Path(configured).exists() else shutil.which("colmap")
    if not colmap:
        return {
            "status": "needs_colmap",
            "message": (
                f"Saved {frame_count} frames. Install COLMAP and put it on PATH, "
                "or set COLMAP_BIN, then call /reconstruct again."
            ),
            "obj_path": None,
            "point_count": 0,
        }

    database = work_dir / "database.db"
    images = work_dir / "images"
    sparse = work_dir / "sparse"
    sparse.mkdir(exist_ok=True)

    commands = [
        colmap_command(
            colmap,
            ["feature_extractor", "--database_path", str(database), "--image_path", str(images)],
        ),
        colmap_command(colmap, ["exhaustive_matcher", "--database_path", str(database)]),
        colmap_command(
            colmap,
            [
                "mapper",
                "--database_path",
                str(database),
                "--image_path",
                str(images),
                "--output_path",
                str(sparse),
            ],
        ),
    ]
    for command in commands:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=900)
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "COLMAP failed").strip()
            return {
                "status": "failed",
                "message": detail[-500:],
                "obj_path": None,
                "point_count": 0,
            }

    model_dir = next(sparse.glob("*/points3D.bin"), None)
    if model_dir is None:
        model_dir = next(sparse.glob("*/cameras.bin"), None)
    if model_dir is None:
        return {
            "status": "failed",
            "message": "COLMAP finished without a sparse model. Capture more overlap around the foot.",
            "obj_path": None,
            "point_count": 0,
        }

    model_dir = model_dir.parent
    points_txt = model_dir / "points3D.txt"
    convert = subprocess.run(
        colmap_command(
            colmap,
            [
                "model_converter",
                "--input_path",
                str(model_dir),
                "--output_path",
                str(model_dir),
                "--output_type",
                "TXT",
            ],
        ),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if convert.returncode != 0 or not points_txt.exists():
        return {
            "status": "failed",
            "message": "COLMAP could not export points3D.txt.",
            "obj_path": None,
            "point_count": 0,
        }

    obj_path = work_dir / "foot.obj"
    point_count = points3d_to_obj(points_txt, obj_path)
    if point_count < 20:
        return {
            "status": "failed",
            "message": f"Only {point_count} sparse points. Move the camera more slowly with more overlap.",
            "obj_path": None,
            "point_count": point_count,
        }

    return {
        "status": "ready",
        "message": f"Sparse foot cloud with {point_count} points. This is not a watertight mesh yet.",
        "obj_path": str(obj_path),
        "point_count": point_count,
    }


def points3d_to_obj(points_file: Path, obj_path: Path) -> int:
    lines = ["# closette sparse foot cloud"]
    count = 0
    for raw in points_file.read_text(encoding="utf-8").splitlines():
        if not raw or raw.startswith("#"):
            continue
        parts = raw.split()
        if len(parts) < 4:
            continue
        lines.append(f"v {parts[1]} {parts[2]} {parts[3]}")
        count += 1
    obj_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return count


def load_backend_env() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def upload_object(local_path: Path, object_path: str) -> str | None:
    load_backend_env()
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    bucket = os.environ.get("SUPABASE_FOOT_SCANS_BUCKET", "foot-scans")
    if not base or not key:
        return None

    request = Request(
        f"{base}/storage/v1/object/{bucket}/{object_path}",
        data=local_path.read_bytes(),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "model/obj",
            "x-upsert": "true",
        },
    )
    try:
        with urlopen(request) as response:
            response.read()
    except (HTTPError, URLError):
        return None
    return f"{base}/storage/v1/object/public/{bucket}/{object_path}"
