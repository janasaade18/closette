"""Prepare a foot-scan dataset for photogrammetry.

COLMAP / OpenMVS will replace the needs_colmap return once the
multi-view pipeline is wired. This worker must stay on the server.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.request import urlopen

WORK_ROOT = Path(__file__).resolve().parent / "work"


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
        "reconstruction": {
            "status": "needs_colmap",
            "glb": None,
            "obj": None,
        },
    }
    (work_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )

    return {
        "status": "needs_colmap",
        "work_dir": str(work_dir),
        "glb_url": None,
        "obj_url": None,
        "message": f"Saved {len(saved)} frames. Next step is COLMAP pose + dense reconstruction.",
        "frame_count": len(saved),
    }