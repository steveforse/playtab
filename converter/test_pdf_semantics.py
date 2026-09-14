import unittest

from pdf_musicxml import build_musicxml
from pdf_semantics import compare_scores, musicxml_to_score


class PdfSemanticsTest(unittest.TestCase):
    def test_reports_exact_visible_and_positioned_matches(self):
        source = {
            "measures": 1,
            "notes": [
                {"measure": 0, "position": 0, "string": 0, "fret": 0, "dead": False},
                {"measure": 0, "position": 64, "string": 0, "fret": 1, "dead": False},
                {"measure": 0, "position": 128, "string": 1, "fret": 2, "dead": False},
            ],
            "texts": [{"text": "Verse"}],
            "chords": [{"name": "C min"}],
            "lyrics_text": "Verse",
        }

        result = compare_scores(source, {**source, "sections": [{"text": "Verse"}], "lyrics": "Verse"})

        self.assertTrue(result["notes"]["visible_overlap"]["exact"])
        self.assertTrue(result["notes"]["positioned_overlap"]["exact"])
        self.assertEqual(result["notes"]["sequence_similarity"], 1.0)
        self.assertTrue(result["metadata"]["sections"]["exact"])
        self.assertTrue(result["metadata"]["lyrics"]["candidate"])

    def test_reports_partial_overlap_without_treating_layout_difference_as_parse_failure(self):
        source = {
            "measures": 2,
            "notes": [
                {"measure": 0, "position": 0, "string": 0, "fret": 0},
                {"measure": 1, "position": 0, "string": 1, "fret": 3},
            ],
        }
        candidate = {
            "measures": 3,
            "notes": [
                {"measure": 0, "position": 0, "string": 0, "fret": 0},
                {"measure": 2, "position": 0, "string": 1, "fret": 3},
            ],
        }

        result = compare_scores(source, candidate)

        self.assertFalse(result["notes"]["visible_overlap"]["exact"])
        self.assertEqual(result["notes"]["visible_overlap"]["matched"], 1)
        self.assertEqual(result["notes"]["sequence_similarity"], 1.0)
        self.assertEqual(result["measures"]["delta"], 1)

    def test_compares_metadata_case_insensitively_and_deduplicates_by_count(self):
        source = {
            "texts": [{"text": "Verse"}, {"text": "Verse"}],
            "chords": [{"name": "C min"}],
        }
        candidate = {
            "sections": [{"text": "VERSE"}],
            "chords": [{"name": "C min"}, {"name": "C min"}],
        }

        result = compare_scores(source, candidate)

        self.assertEqual(result["metadata"]["sections"]["matched"], 1)
        self.assertEqual(result["metadata"]["chords"]["matched"], 1)
        self.assertFalse(result["metadata"]["chords"]["exact"])

    def test_reads_back_the_pdf_musicxml_note_and_timing_contract(self):
        source = {
            "title": "Demo",
            "tuning_label": "gDGBD",
            "measures": 1,
            "time_signature": {"numerator": 4, "denominator": 4},
            "notes": [
                {"measure": 0, "position": 0, "string": 0, "fret": 0, "dead": False},
                {"measure": 0, "position": 128, "string": 1, "fret": 2, "dead": False},
            ],
            "sections": [],
            "chords": [],
            "lyrics": None,
            "techniques": [],
            "fingerings": [],
        }

        roundtrip = musicxml_to_score(build_musicxml(source))

        result = compare_scores(source, roundtrip)
        self.assertTrue(result["notes"]["positioned_overlap"]["exact"])


if __name__ == "__main__":
    unittest.main()
