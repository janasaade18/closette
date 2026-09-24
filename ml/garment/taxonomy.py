import json
from pathlib import Path

TAXONOMY_PATH = Path(__file__).with_name("taxonomy.json")


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


def map_source_label(source: str, raw_label: str, taxonomy: dict | None = None) -> str | None:
    data = taxonomy or load_taxonomy()
    table = data["sources"].get(source, {})
    return table.get(raw_label.strip().lower())
