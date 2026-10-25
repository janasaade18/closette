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
        coarse_label = None
        if localization is not None:
            bbox = [int(value) for value in localization.bbox]
            crop = image.crop(padded_box(localization.bbox, image.width, image.height))
            coarse_groups = localization.groups
            coarse_label = localization.coarse_label
            if include_mask:
                from inference.localize import encode_rle

                mask = encode_rle(localization.mask)
        if crop.width < 1 or crop.height < 1:
            crop = image
            bbox = None
            mask = None
            coarse_groups = None
            coarse_label = None

        try:
            scores = self.classifier.predict(crop)
        except Exception as exc:
            raise ModelError("The classifier failed to score this image.") from exc
        if crop is not image:
            scores = self._resolve_skirt_dress(image, scores, coarse_label, coarse_groups or set())
            scores = self._resolve_pants_as_jumpsuit(image, scores, coarse_label)
            scores = self._resolve_hidden_sleeves(image, scores)

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

    def _resolve_skirt_dress(
        self,
        image: Image.Image,
        crop_scores: Scores,
        coarse_label: str | None,
        coarse_groups: set[str],
    ) -> Scores:
        """Waist-cut skirt crops often look like dresses.

        1. Detect dress/skirt conflict on the crop.
        2. Rescore the full photo.
        3. Keep the view with stronger skirt-vs-dress evidence.
        Review is left to _decide when the pair stays within the margin.
        """
        if not self._skirt_dress_conflict(crop_scores, coarse_label, coarse_groups):
            return crop_scores
        full_scores = self._full_scores(image)
        if full_scores is None:
            return crop_scores
        return self._stronger_skirt_dress(crop_scores, full_scores, coarse_groups)

    def _skirt_dress_conflict(
        self,
        scores: Scores,
        coarse_label: str | None,
        coarse_groups: set[str],
    ) -> bool:
        if not scores.by_label:
            return False
        ranked = sorted(scores.by_label.items(), key=lambda item: item[1], reverse=True)
        top_label, top_score = ranked[0]
        second_label, second_score = ranked[1] if len(ranked) > 1 else (None, 0.0)
        margin = float(self.policy["ambiguous_margin"])
        hard_floor = float(self.policy["hard_floor"])
        skirt = float(scores.by_label.get("skirt", 0.0))

        # Only the leading names count. A close dress/skirt pair buried under
        # another label must not throw away that label.
        if {top_label, second_label} == {"dress", "skirt"} and abs(top_score - second_score) <= margin:
            return True
        # A skirt or bottoms region called a dress or other one-piece is the waist-cut case.
        if coarse_label == "Skirt" and self._category_of(scores) == "one-piece":
            return True
        if "bottoms" in coarse_groups and top_label == "dress" and skirt >= hard_floor:
            return True
        return False

    def _stronger_skirt_dress(
        self,
        crop_scores: Scores,
        full_scores: Scores,
        coarse_groups: set[str],
    ) -> Scores:
        hard_floor = float(self.policy["hard_floor"])
        crop_peak = max(crop_scores.by_label.values(), default=0.0)
        full_peak = max(full_scores.by_label.values(), default=0.0)
        if full_peak < hard_floor:
            return crop_scores

        crop_evidence = float(crop_scores.by_label.get("skirt", 0.0)) - float(
            crop_scores.by_label.get("dress", 0.0)
        )
        full_evidence = float(full_scores.by_label.get("skirt", 0.0)) - float(
            full_scores.by_label.get("dress", 0.0)
        )
        full_category = self._category_of(full_scores)
        crop_category = self._category_of(crop_scores)

        if full_evidence > crop_evidence:
            return full_scores
        if crop_evidence > full_evidence:
            return crop_scores
        if coarse_groups and full_category in coarse_groups and crop_category not in coarse_groups:
            return full_scores
        if coarse_groups and crop_category in coarse_groups and full_category not in coarse_groups:
            return crop_scores
        return full_scores if full_peak >= crop_peak else crop_scores

    def _resolve_pants_as_jumpsuit(
        self,
        image: Image.Image,
        crop_scores: Scores,
        coarse_label: str | None,
    ) -> Scores:
        """A jumpsuit cropped to the legs looks like trousers.

        Use the full photo when that photo is a confident jumpsuit.
        """
        if coarse_label != "Pants":
            return crop_scores
        top_label, top_score = self._top(crop_scores)
        if top_label not in {"trousers", "jeans", "chinos"}:
            return crop_scores
        full_scores = self._full_scores(image)
        if full_scores is None:
            return crop_scores
        full_label, full_score = self._top(full_scores)
        abstain = float(self.policy["abstain_below"])
        if full_label == "jumpsuit" and full_score >= abstain and full_score > top_score:
            return full_scores
        return crop_scores

    def _resolve_hidden_sleeves(self, image: Image.Image, crop_scores: Scores) -> Scores:
        """A folded t-shirt crop hides the sleeves and looks like a tank top.

        The full photo is used when it clearly says t-shirt.
        """
        top_label, _top_score = self._top(crop_scores)
        if top_label != "tank-top":
            return crop_scores
        full_scores = self._full_scores(image)
        if full_scores is None:
            return crop_scores
        full_label, full_score = self._top(full_scores)
        if full_label == "t-shirt" and full_score >= float(self.policy["abstain_below"]):
            return full_scores
        return crop_scores

    def _full_scores(self, image: Image.Image) -> Scores | None:
        try:
            return self.classifier.predict(image)
        except Exception:
            logger.warning("full-frame rescore failed", exc_info=True)
            return None

    def _top(self, scores: Scores) -> tuple[str | None, float]:
        if not scores.by_label:
            return None, 0.0
        label, score = max(scores.by_label.items(), key=lambda item: item[1])
        return label, float(score)

    def _category_of(self, scores: Scores) -> str | None:
        label, _score = self._top(scores)
        if label is None:
            return None
        return self.groups.get(label)

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
            # Keep a more specific reason (e.g. dress vs skirt) when one exists.
            if reason is None:
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
