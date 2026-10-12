"""Photo -> localize -> crop -> subcategory.

One primary garment. Category is the parent of the chosen subcategory.
"""

from __future__ import annotations

import logging
import time

from PIL import Image

from inference.classify import Scores, build_classifier
from inference.contract import classification_body
from inference.localize import SegFormerSegmenter, padded_box
from taxonomy import is_ambiguous, load_taxonomy, type_to_group

logger = logging.getLogger("closette.garment")


class ModelError(Exception):
    pass


class GarmentPipeline:
    def __init__(self, classifier, segmenter=None, taxonomy: dict | None = None) -> None:
        self.classifier = classifier
        self.segmenter = segmenter
        self.taxonomy = taxonomy or load_taxonomy()
        self.groups = type_to_group(self.taxonomy)
        self.policy = self.taxonomy["policy"]

    def predict_image(
        self,
        image: Image.Image,
        *,
        include_embedding: bool = False,
        include_mask: bool = True,
    ) -> dict:
        started = time.perf_counter()
        localization, segmenter_ran = self._localize(image)
        if segmenter_ran and localization is None:
            return self._blank(
                "no_garment",
                segmenter_name=getattr(self.segmenter, "name", None),
                latency_ms=(time.perf_counter() - started) * 1000,
            )

        crop = image
        bbox = None
        mask = None
        coarse_groups = None
        if localization is not None:
            bbox = [int(value) for value in localization.bbox]
            crop = image.crop(padded_box(localization.bbox, image.width, image.height))
            coarse_groups = localization.groups
            if include_mask:
                from inference.localize import encode_rle

                mask = encode_rle(localization.mask)
        if crop.width < 1 or crop.height < 1:
            crop = image
            bbox = None
            mask = None
            coarse_groups = None

        try:
            scores = self.classifier.predict(crop)
        except Exception as exc:
            raise ModelError("The classifier failed to score this image.") from exc

        return self._decide(
            scores,
            coarse_groups=coarse_groups,
            bbox=bbox,
            mask=mask,
            include_embedding=include_embedding,
            segmenter_name=getattr(self.segmenter, "name", None) if segmenter_ran else None,
            latency_ms=(time.perf_counter() - started) * 1000,
        )

    def _localize(self, image: Image.Image):
        """Return the localization and whether the segmenter actually ran."""
        if self.segmenter is None:
            return None, False
        try:
            return self.segmenter.segment(image), True
        except Exception:
            logger.warning("segmentation failed", exc_info=True)
            return None, False

    def _decide(
        self,
        scores: Scores,
        *,
        coarse_groups: set[str] | None,
        bbox,
        mask,
        include_embedding: bool,
        segmenter_name: str | None,
        latency_ms: float,
    ) -> dict:
        ranked = sorted(scores.by_label.items(), key=lambda item: item[1], reverse=True)
        if not ranked:
            raise ModelError("The classifier returned no labels.")
        top_label, top_score = ranked[0]
        second_label, second_score = ranked[1] if len(ranked) > 1 else (None, 0.0)
        if top_label not in self.groups:
            raise ModelError(f"Classifier returned an unknown label {top_label}")
        category = self.groups[top_label]
        hard_floor = float(self.policy["hard_floor"])
        abstain = float(self.policy["abstain_below"])
        margin = float(self.policy["ambiguous_margin"])

        reason = None
        status = "success"
        if top_score < hard_floor:
            return self._unclear("low_confidence", scores, segmenter_name, latency_ms)
        if top_score < abstain:
            status = "review"
            reason = "low_confidence"
        elif (
            second_label
            and top_score - second_score < margin
            and is_ambiguous(top_label, second_label, self.taxonomy)
        ):
            status = "review"
            reason = "ambiguous_pair"
        if coarse_groups is not None and category not in coarse_groups:
            status = "review"
            reason = "localization_disagrees"

        alternatives = [
            {
                "category": self.groups[label],
                "subcategory": label,
                "confidence": round(score, 4),
            }
            for label, score in ranked[:3]
        ]
        embedding = scores.embedding if include_embedding else None
        return classification_body(
            status=status,
            category=category,
            subcategory=top_label,
            confidence=top_score,
            bbox=bbox,
            mask=mask,
            embedding=embedding,
            reason=reason,
            alternatives=alternatives,
            latency_ms=latency_ms,
            models=_models(scores, segmenter_name, self.taxonomy["version"]),
        )

    def _unclear(self, reason: str, scores: Scores, segmenter_name: str | None, latency_ms: float) -> dict:
        return classification_body(
            status="unclear",
            category=None,
            subcategory=None,
            confidence=None,
            bbox=None,
            mask=None,
            embedding=None,
            reason=reason,
            alternatives=None,
            latency_ms=latency_ms,
            models=_models(scores, segmenter_name, self.taxonomy["version"]),
        )

    def _blank(self, reason: str, segmenter_name: str | None, latency_ms: float) -> dict:
        return classification_body(
            status="unclear",
            category=None,
            subcategory=None,
            confidence=None,
            bbox=None,
            mask=None,
            embedding=None,
            reason=reason,
            alternatives=None,
            latency_ms=latency_ms,
            models={
                "classifier": getattr(self.classifier, "name", "unknown"),
                "classifier_id": getattr(self.classifier, "model_id", None),
                "segmenter": segmenter_name,
                "taxonomy_version": self.taxonomy["version"],
                "embedding_dim": None,
            },
        )


def _models(scores: Scores, segmenter_name: str | None, taxonomy_version: int) -> dict:
    return {
        "classifier": scores.model_name,
        "classifier_id": scores.model_id,
        "segmenter": segmenter_name,
        "taxonomy_version": taxonomy_version,
        "embedding_dim": None if scores.embedding is None else len(scores.embedding),
    }


def build_default_pipeline(classifier: str = "auto", segmenter: str = "auto") -> GarmentPipeline:
    import os

    classifier_choice = os.environ.get("CLOSETTE_CLASSIFIER", classifier)
    segmenter_choice = os.environ.get("CLOSETTE_SEGMENTER", segmenter)
    model = build_classifier(classifier_choice)
    clothes = None
    if segmenter_choice != "none":
        try:
            __import__("transformers")
        except ImportError:
            logger.warning("transformers is not installed; segmentation is off")
        else:
            clothes = SegFormerSegmenter()
    return GarmentPipeline(model, clothes)
