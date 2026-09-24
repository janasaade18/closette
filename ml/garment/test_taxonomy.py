import unittest

from taxonomy import class_names, load_taxonomy, map_source_label, type_to_group


class TaxonomyTest(unittest.TestCase):
    def test_every_type_has_one_group(self) -> None:
        names = class_names()
        groups = type_to_group()
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(set(names), set(groups))

    def test_source_labels_land_on_known_types(self) -> None:
        taxonomy = load_taxonomy()
        known = set(class_names(taxonomy))
        for source, table in taxonomy["sources"].items():
            for raw, mapped in table.items():
                self.assertEqual(map_source_label(source, raw, taxonomy), mapped)
                self.assertIn(mapped, known)

    def test_unmapped_labels_are_skipped(self) -> None:
        self.assertIsNone(map_source_label("deepfashion2", "sling"))
        self.assertIsNone(map_source_label("fashionpedia", "sleeve"))
        self.assertIsNone(map_source_label("fashionpedia", "cape"))


if __name__ == "__main__":
    unittest.main()
