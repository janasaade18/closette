import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from taxonomy import class_names, load_taxonomy, map_source_label, source_quality, type_to_group


class TaxonomyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.taxonomy = load_taxonomy()

    def test_every_type_has_one_group_and_a_definition(self) -> None:
        names = class_names(self.taxonomy)
        groups = type_to_group(self.taxonomy)
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(set(names), set(groups))
        self.assertEqual(set(names), set(self.taxonomy["labels"]))
        for name in names:
            label = self.taxonomy["labels"][name]
            self.assertTrue(label["definition"])
            self.assertTrue(label["prompt"])
            self.assertIn(label["supervision"], {"direct", "weak", "zero-shot"})

    def test_hierarchy_matches_the_product_categories(self) -> None:
        self.assertEqual(
            [group["id"] for group in self.taxonomy["groups"]],
            ["tops", "bottoms", "one-piece", "outerwear", "footwear", "accessories"],
        )
        self.assertIn("t-shirt", self.taxonomy["groups"][0]["types"])
        self.assertIn("jeans", type_to_group(self.taxonomy))
        self.assertEqual(type_to_group(self.taxonomy)["trench-coat"], "outerwear")

    def test_ambiguous_pairs_are_symmetric(self) -> None:
        labels = self.taxonomy["labels"]
        for name, label in labels.items():
            for other in label["ambiguous_with"]:
                self.assertIn(other, labels)
                self.assertIn(name, labels[other]["ambiguous_with"])

    def test_supervision_matches_source_rows(self) -> None:
        direct = set()
        weak = set()
        for source, table in self.taxonomy["sources"].items():
            for raw, mapped in table.items():
                quality = source_quality(source, raw, self.taxonomy)
                self.assertEqual(map_source_label(source, raw, self.taxonomy), mapped)
                self.assertIn(mapped, class_names(self.taxonomy))
                (weak if quality == "weak" else direct).add(mapped)
        for name, label in self.taxonomy["labels"].items():
            if label["supervision"] == "direct":
                self.assertIn(name, direct)
                self.assertNotIn(name, weak)
            elif label["supervision"] == "weak":
                self.assertIn(name, weak)
                self.assertNotIn(name, direct)
            else:
                self.assertNotIn(name, direct | weak)

    def test_mixed_dataset_labels_are_not_forced_into_one_subcategory(self) -> None:
        self.assertIsNone(map_source_label("fashionpedia", "shirt, blouse"))
        self.assertIsNone(map_source_label("fashionpedia", "top, t-shirt, sweatshirt"))
        self.assertIsNone(map_source_label("fashionpedia", "shoe"))
        self.assertIsNone(map_source_label("fashionpedia", "vest"))
        self.assertIsNone(map_source_label("deepfashion2", "vest"))
        self.assertIsNone(map_source_label("fashionpedia", "sleeve"))
        self.assertEqual(source_quality("deepfashion2", "short sleeve top"), "weak")
        self.assertEqual(source_quality("fashionpedia", "dress"), "direct")


if __name__ == "__main__":
    unittest.main()
