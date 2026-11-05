"""Refresh the FashionCLIP and SegFormer copies stored in weights/.

Normal checkouts already have these folders. Run this only to replace them.
"""

from __future__ import annotations

import os

os.environ["HF_HUB_DISABLE_XET"] = "1"

from huggingface_hub import snapshot_download

from paths import FASHIONCLIP_DIR, SEGFORMER_DIR

SKIP = [
    "*.h5",
    "*.msgpack",
    "*.ot",
    "flax_model*",
    "tf_model*",
    "rust_model*",
    "onnx/*",
    "pytorch_model.bin",
]


def main() -> None:
    snapshot_download(
        "patrickjohncyh/fashion-clip",
        local_dir=FASHIONCLIP_DIR,
        ignore_patterns=SKIP,
    )
    snapshot_download(
        "mattmdjaga/segformer_b2_clothes",
        local_dir=SEGFORMER_DIR,
        ignore_patterns=SKIP,
    )
    print(f"saved {FASHIONCLIP_DIR}")
    print(f"saved {SEGFORMER_DIR}")


if __name__ == "__main__":
    main()
