"""Download FashionCLIP and SegFormer into the local Hugging Face cache."""

from __future__ import annotations

from PIL import Image

from inference.classify import build_classifier
from inference.localize import SegFormerSegmenter


def main() -> None:
    image = Image.new("RGB", (224, 224), (180, 180, 180))
    segmenter = SegFormerSegmenter()
    classifier = build_classifier("fashion-clip")
    segmenter.segment(image)
    classifier.predict(image)
    print("weights cached")


if __name__ == "__main__":
    main()
