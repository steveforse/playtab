import hashlib
import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('review', Path(__file__).parents[1] / 'script/review_musicxml.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewTest(unittest.TestCase):
    def setUp(self):
        pitch = '<pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><notehead parentheses="yes">normal</notehead>'
        self.source = ('<score-partwise><part><measure><attributes><divisions>1</divisions></attributes><note>' + pitch + '<staff>1</staff></note><backup><duration>1</duration></backup><note>' + pitch + '<staff>2</staff><notations><technical><string>4</string><fret>9</fret></technical></notations></note></measure></part></score-partwise>').encode()
        self.manifest = {'source_sha256': hashlib.sha256(self.source).hexdigest(), 'corrections': [dict(measure=1, tick=0, string=4, expected_fret=9, fret=5, expected_midi=57, midi=53, finger=3)]}

    def test_review_changes_pitch_and_fret_but_keeps_finger_separate(self):
        result = ET.fromstring(review.correct(self.source, self.manifest))
        self.assertEqual(result.findtext('.//fret'), '5')
        self.assertEqual([n.text for n in result.findall('.//pitch/step')], ['F', 'F'])
        self.assertEqual([n.text for n in result.findall('.//fingering')], ['3', '3'])
        self.assertFalse(any(n.get('parentheses') for n in result.findall('.//notehead')))

    def test_mismatched_source_and_note_are_rejected(self):
        with self.assertRaises(ValueError):
            review.correct(self.source + b' ', self.manifest)
        self.manifest['corrections'][0]['expected_fret'] = 8
        with self.assertRaises(ValueError):
            review.correct(self.source, self.manifest)


if __name__ == '__main__':
    unittest.main()
