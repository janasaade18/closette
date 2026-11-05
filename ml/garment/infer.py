"""Classify one photograph and print the API JSON."""

from __future__ import annotations

import argparse
import json

from inference.pipeline import build_default_pipeline
from inference.validate import load_image


def main() -> None:
    parser = argparse.ArgumentParser(description="Classify the primary garment in one photo")
    parser.add_argument("image")
    parser.add_argument("--embedding", action="store_true")
    parser.add_argument("--no-mask", action="store_true")
    args = parser.parse_args()
    with open(args.image, "rb") as handle:
        photo = load_image(handle.read())
    result = build_default_pipeline().predict_image(
        photo,
        include_embedding=args.embedding,
        include_mask=not args.no_mask,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
