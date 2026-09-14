import unittest
from xml.etree import ElementTree as ET

from pdf_musicxml import build_musicxml


class PdfMusicxmlTest(unittest.TestCase):
    def test_builds_tab_musicxml_with_pdf_metadata(self):
        source = {
            "title": "Demo",
            "tuning_label": "gDGBD",
            "measures": 1,
            "time_signature": {"numerator": 4, "denominator": 4},
            "tempo": None,
            "notes": [
                {"measure": 0, "position": 0, "string": 0, "fret": 0, "dead": False},
                {"measure": 0, "position": 64, "string": 0, "fret": 1, "dead": False},
                {"measure": 0, "position": 128, "string": 0, "fret": 2, "dead": False},
            ],
            "sections": [{"measure": 0, "position": 128, "text": "Verse"}],
            "chords": [{"measure": 0, "position": 512, "name": "C min"}],
            "lyrics": "VERSE\nOne line",
            "techniques": [{"measure": 0, "position": 0, "string": 0, "type": "hammer-on", "label": "H"}],
            "fingerings": [{"measure": 0, "position": 128, "string": 0, "value": "3"}],
        }

        xml = build_musicxml(source)
        root = ET.fromstring(xml)
        self.assertEqual(root.findtext("work/work-title"), "Demo")
        self.assertEqual(root.findtext(".//miscellaneous-field"), "VERSE\nOne line")
        self.assertEqual(root.findtext(".//staff-tuning[1]/tuning-step"), "G")
        self.assertEqual(root.findtext(".//direction/direction-type/words"), "Verse")
        self.assertEqual(root.findtext(".//harmony/root/root-step"), "C")
        self.assertEqual(root.findtext(".//harmony/kind"), "minor")
        self.assertIsNotNone(root.find(".//hammer-on[@type='start']"))
        self.assertIsNotNone(root.find(".//hammer-on[@type='stop']"))
        self.assertEqual(root.findtext(".//fingering"), "3")


if __name__ == "__main__":
    unittest.main()
