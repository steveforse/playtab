"""Apply source-hash-bound, human-reviewed note corrections, never decoder guesses.

Usage: python3 script/review_musicxml.py INPUT_XML REVIEW_JSON OUTPUT_XML
The original input is retained. Review files for private music belong in tmp/.
"""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def correct(source: bytes, review: dict) -> bytes:
    if hashlib.sha256(source).hexdigest() != review['source_sha256']:
        raise ValueError('Review does not match this exact source XML')
    root = ET.fromstring(source)
    parts = root.findall('part')
    if len(parts) != 1:
        raise ValueError('Review currently requires one part')
    for correction in review['corrections']:
        measures = parts[0].findall('measure')
        divisions = 1
        matches = []
        for index, measure in enumerate(measures):
            tick = previous = 0
            for node in measure:
                if node.tag == 'attributes':
                    divisions = int(node.findtext('divisions', str(divisions)))
                elif node.tag in ('backup', 'forward'):
                    tick += int(node.findtext('duration')) * 960 / divisions * (-1 if node.tag == 'backup' else 1)
                elif node.tag == 'note':
                    onset = previous if node.find('chord') is not None else tick
                    if node.find('chord') is None:
                        previous = onset
                        tick += int(node.findtext('duration', '0')) * 960 / divisions
                    if index + 1 == correction['measure'] and onset == correction['tick']:
                        fret = node.findtext('notations/technical/fret')
                        string = node.findtext('notations/technical/string')
                        if fret is not None and (int(fret) != correction['expected_fret'] or int(string) != correction['string']):
                            continue
                        pitch = node.find('pitch')
                        if pitch is None:
                            continue
                        midi = 'C D EF G A B'.index(pitch.findtext('step')) + int(pitch.findtext('alter', '0')) + 12 * (int(pitch.findtext('octave')) + 1)
                        if midi == correction['expected_midi']:
                            matches.append(node)
        if len(matches) != 2 or sum(n.find('notations/technical/fret') is not None for n in matches) != 1:
            raise ValueError('Expected one matching standard note and one matching TAB note')
        for node in matches:
            pitch = node.find('pitch')
            step, alter = [('C',0),('C',1),('D',0),('E',-1),('E',0),('F',0),('F',1),('G',0),('A',-1),('A',0),('B',-1),('B',0)][correction['midi'] % 12]
            pitch.clear()
            ET.SubElement(pitch, 'step').text = step
            if alter:
                ET.SubElement(pitch, 'alter').text = str(alter)
            ET.SubElement(pitch, 'octave').text = str(correction['midi'] // 12 - 1)
            notations = node.find('notations')
            if notations is None:
                notations = ET.SubElement(node, 'notations')
            technical = notations.find('technical')
            if technical is None:
                technical = ET.SubElement(notations, 'technical')
            fret = technical.find('fret')
            if fret is not None:
                fret.text = str(correction['fret'])
            fingering = ET.SubElement(technical, 'fingering', {'enclosure': 'circle'})
            fingering.text = str(correction['finger'])
            for head in node.findall('notehead'):
                head.attrib.pop('parentheses', None)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


if __name__ == '__main__':
    source, review, output = map(Path, sys.argv[1:])
    if source.resolve() == output.resolve():
        raise ValueError('Output must not overwrite the unreviewed source')
    result = correct(source.read_bytes(), json.loads(review.read_text()))
    output.write_bytes(result)
