"""Accuracy, macro-F1, per-class precision and recall, and a confusion matrix."""

from __future__ import annotations


def score_predictions(y_true: list[str], y_pred: list[str]) -> dict:
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must be the same length")
    labels = sorted(set(y_true) | set(y_pred))
    matrix = {actual: {predicted: 0 for predicted in labels} for actual in labels}
    for actual, predicted in zip(y_true, y_pred):
        matrix[actual][predicted] += 1

    per_class = {}
    f1_values = []
    supported = [label for label in labels if sum(matrix[label].values()) > 0]
    for label in supported:
        support = sum(matrix[label].values())
        predicted_count = sum(matrix[actual][label] for actual in labels)
        hits = matrix[label][label]
        precision = hits / predicted_count if predicted_count else 0.0
        recall = hits / support if support else 0.0
        f1 = _f1(precision, recall)
        per_class[label] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": support,
        }
        f1_values.append(f1)

    total = len(y_true)
    correct = sum(1 for actual, predicted in zip(y_true, y_pred) if actual == predicted)
    accuracy = correct / total if total else 0.0
    macro_f1 = sum(f1_values) / len(f1_values) if f1_values else 0.0
    return {
        "accuracy": round(accuracy, 4),
        "macro_f1": round(macro_f1, 4),
        "support": total,
        "per_class": per_class,
        "confusion": matrix,
    }


def _f1(precision: float, recall: float) -> float:
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)
