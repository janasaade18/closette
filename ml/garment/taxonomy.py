import json
from pathlib import Path

TAXONOMY_PATH = Path(__file__).with_name("taxonomy.json")
MODEL_VERSION = "closet-classifier-v1"


def load_taxonomy(path: Path = TAXONOMY_PATH) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def class_names(taxonomy: dict | None = None) -> list[str]:
    data = taxonomy or load_taxonomy()
    names: list[str] = []
    for group in data["groups"]:
        names.extend(group["types"])
    return names


def type_to_group(taxonomy: dict | None = None) -> dict[str, str]:
    data = taxonomy or load_taxonomy()
    mapping: dict[str, str] = {}
    for group in data["groups"]:
        for garment_type in group["types"]:
            mapping[garment_type] = group["id"]
    return mapping


def label_meta(subcategory: str, taxonomy: dict | None = None) -> dict:
    data = taxonomy or load_taxonomy()
    try:
        return data["labels"][subcategory]
    except KeyError as exc:
        raise KeyError(f"Unknown subcategory {subcategory}") from exc


def prompts(taxonomy: dict | None = None) -> list[tuple[str, str]]:
    data = taxonomy or load_taxonomy()
    return [(name, data["labels"][name]["prompt"]) for name in class_names(data)]


def map_source_label(source: str, raw_label: str, taxonomy: dict | None = None) -> str | None:
    data = taxonomy or load_taxonomy()
    table = data["sources"].get(source, {})
    return table.get(raw_label.strip().lower())


def source_quality(source: str, raw_label: str, taxonomy: dict | None = None) -> str | None:
    data = taxonomy or load_taxonomy()
    raw = raw_label.strip().lower()
    if map_source_label(source, raw, data) is None:
        return None
    weak = data.get("weak_sources", {}).get(source, [])
    return "weak" if raw in weak else "direct"


def is_ambiguous(first: str, second: str, taxonomy: dict | None = None) -> bool:
    data = taxonomy or load_taxonomy()
    return second in data["labels"][first].get("ambiguous_with", [])
