import unittest
from unittest.mock import patch

from pdf_recognizer import PdfRecognitionError, PdfRecognizer


class FakePage:
    def __init__(self, with_staff=True):
        self.with_staff = with_staff

    def extract_text(self, visitor_text, visitor_operand_before):
        if not self.with_staff:
            visitor_text("title", (1, 0, 0, 1, 0, 0), (1, 0, 0, 1, 100, 750), None, 12)
            return

        matrix = (1, 0, 0, 1, 0, 0)
        for y in (600, 610, 620, 630, 640):
            visitor_operand_before(b"m", [20, y], matrix, None)
            visitor_operand_before(b"l", [580, y], matrix, None)
        for x in (20, 300, 580):
            visitor_operand_before(b"m", [x, 600], matrix, None)
            visitor_operand_before(b"l", [x, 640], matrix, None)
        visitor_text("Demo", matrix, (1, 0, 0, 1, 100, 750), None, 12)
        visitor_text("gDGBD tuning", matrix, (1, 0, 0, 1, 150, 740), None, 12)
        visitor_text("0", matrix, (1, 0, 0, 1, 40, 636.4), None, 12)


class FakeReader:
    def __init__(self, pages):
        self.pages = pages


class MetadataPage(FakePage):
    def extract_text(self, visitor_text, visitor_operand_before):
        super().extract_text(visitor_text, visitor_operand_before)
        matrix = (1, 0, 0, 1, 0, 0)
        visitor_text("Verse", matrix, (1, 0, 0, 1, 40, 570), None, 12)
        visitor_text("C min", matrix, (1, 0, 0, 1, 40, 653), None, 12)
        visitor_text("H", matrix, (1, 0, 0, 1, 40, 623), None, 12)
        visitor_text("Sl", matrix, (1, 0, 0, 1, 55, 623), None, 12)
        visitor_text("1", matrix, (1, 0, 0, 1, 40, 670), None, 12)


class LyricsPage:
    def extract_text(self, visitor_text, visitor_operand_before):
        matrix = (1, 0, 0, 1, 0, 0)
        for index, line in enumerate(("VERSE", "One line", "Two lines", "Three lines")):
            visitor_text(line, matrix, (1, 0, 0, 1, 40, 700 - index * 16), None, 12)


class PdfRecognizerTest(unittest.TestCase):
    def test_rejects_non_pdf_and_empty_uploads(self):
        recognizer = PdfRecognizer()
        for data in (b"", b"not a pdf"):
            with self.subTest(data=data):
                with self.assertRaises(PdfRecognitionError):
                    recognizer.recognize(data)

    def test_recognizes_staff_notes_and_header_from_positioned_pdf_content(self):
        with patch("pdf_recognizer.PdfReader", return_value=FakeReader([FakePage()])):
            result = PdfRecognizer().recognize(b"%PDF-1.3 synthetic", "Demo.pdf")

        self.assertEqual(result["title"], "Demo")
        self.assertEqual(result["tuning_label"], "gDGBD")
        self.assertEqual(result["measures"], 2)
        self.assertEqual(result["notes"], [{"measure": 0, "position": 0, "string": 0, "fret": 0, "dead": False}])
        self.assertTrue(result["warnings"])

    def test_rejects_pages_without_five_line_tablature(self):
        with patch("pdf_recognizer.PdfReader", return_value=FakeReader([FakePage(with_staff=False)])):
            with self.assertRaisesRegex(PdfRecognitionError, "five-line"):
                PdfRecognizer().recognize(b"%PDF-1.3 synthetic")

    def test_recognizes_layout_metadata_and_a_standalone_lyric_page(self):
        with patch("pdf_recognizer.PdfReader", return_value=FakeReader([MetadataPage(), LyricsPage()])):
            result = PdfRecognizer().recognize(b"%PDF-1.3 synthetic", "Demo.pdf")

        self.assertEqual(result["sections"][0]["text"], "Verse")
        self.assertEqual(result["chords"][0]["name"], "C min")
        self.assertEqual(result["techniques"][0]["type"], "hammer-on")
        self.assertEqual(result["techniques"][1]["type"], "slide")
        self.assertEqual(result["fingerings"][0]["value"], "1")
        self.assertEqual(result["lyrics"], "VERSE\nOne line\nTwo lines\nThree lines")

    def test_position_rounds_to_supported_eighth_note_grid(self):
        self.assertEqual(PdfRecognizer._position(20, 20, 300), 0)
        self.assertEqual(PdfRecognizer._position(160, 20, 300), 512)
        self.assertEqual(PdfRecognizer._position(300, 20, 300), 896)

    def test_position_detects_sixteenth_note_spacing(self):
        self.assertEqual(PdfRecognizer._position_step(20, 220, [45, 56.5, 68]), 64)

    def test_recognizes_selectable_metronome_tempo_forms(self):
        page = {"texts": [{"x": 40, "y": 700, "text": "♩ = 200"}], "systems": []}
        self.assertEqual(PdfRecognizer._tempo([page]), 200)

        split_page = {
            "texts": [
                {"x": 40, "y": 700, "text": "quarter note"},
                {"x": 80, "y": 700, "text": "180"},
            ],
            "systems": [],
        }
        self.assertEqual(PdfRecognizer._tempo([split_page]), 180)


if __name__ == "__main__":
    unittest.main()
