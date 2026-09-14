"""Build a bounded, reviewable MusicXML preview from PDF recognition data."""

from html import escape
import re
from xml.etree import ElementTree as ET


DIVISIONS = 960
MEASURE_TICKS = 3840
PDF_MEASURE_TICKS = 1024
DEFAULT_TUNING = [67, 50, 55, 59, 62]
PITCHES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def build_musicxml(score):
    """Return a one-part five-string TAB MusicXML preview."""
    root = ET.Element("score-partwise", version="3.1")
    identification = ET.SubElement(root, "identification")
    miscellaneous = ET.SubElement(identification, "miscellaneous")
    if score.get("lyrics"):
        field = ET.SubElement(miscellaneous, "miscellaneous-field", name="playtab-lyrics")
        field.text = score["lyrics"]

    work = ET.SubElement(root, "work")
    ET.SubElement(work, "work-title").text = score.get("title", "Imported PDF")
    part_list = ET.SubElement(root, "part-list")
    score_part = ET.SubElement(part_list, "score-part", id="P1")
    ET.SubElement(score_part, "part-name").text = "Banjo"
    instrument = ET.SubElement(score_part, "score-instrument", id="P1-I1")
    ET.SubElement(instrument, "instrument-name").text = "Banjo"
    midi = ET.SubElement(score_part, "midi-instrument", id="P1-I1")
    ET.SubElement(midi, "midi-channel").text = "1"
    ET.SubElement(midi, "midi-program").text = "105"

    part = ET.SubElement(root, "part", id="P1")
    tuning = _parse_tuning(score.get("tuning_label", ""))
    notes = score.get("notes", [])
    technique_map = _techniques_by_note(score, notes)
    fingering_map = _fingerings_by_note(score)
    sections = _metadata_by_measure(score.get("sections", []))
    chords = _metadata_by_measure(score.get("chords", []))

    for measure_index in range(score.get("measures", 0)):
        measure = ET.SubElement(part, "measure", number=str(measure_index + 1))
        if measure_index == 0:
            _write_attributes(measure, score.get("time_signature", {"numerator": 4, "denominator": 4}), tuning)
            if score.get("tempo"):
                direction = ET.SubElement(measure, "direction", placement="above")
                direction_type = ET.SubElement(direction, "direction-type")
                metronome = ET.SubElement(direction_type, "metronome")
                ET.SubElement(metronome, "beat-unit").text = "quarter"
                ET.SubElement(metronome, "per-minute").text = str(score["tempo"])

        for section in sections.get(measure_index, []):
            _write_words(measure, section.get("text", ""), section.get("position", 0))
        for chord in chords.get(measure_index, []):
            _write_harmony(measure, chord.get("name", ""), chord.get("position", 0))

        measure_notes = [note for note in notes if note["measure"] == measure_index]
        events = {}
        for note in measure_notes:
            events.setdefault(note["position"], []).append(note)
        cursor = 0
        positions = sorted(events)
        for event_index, position in enumerate(positions):
            target = _pdf_position_to_xml(position)
            if target > cursor:
                _write_rest(measure, target - cursor)
            next_target = _pdf_position_to_xml(positions[event_index + 1]) if event_index + 1 < len(positions) else MEASURE_TICKS
            duration = max(480, next_target - target) if next_target > target else 480
            duration = min(duration, MEASURE_TICKS - target)
            for note_index, note in enumerate(sorted(events[position], key=lambda value: value["string"])):
                _write_note(
                    measure,
                    note,
                    duration,
                    tuning,
                    chord=note_index > 0,
                    technique=technique_map.get(_note_key(note)),
                    fingering=fingering_map.get(_note_key(note)),
                )
            cursor = target + duration
        if cursor < MEASURE_TICKS:
            _write_rest(measure, MEASURE_TICKS - cursor)

    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    return ET.tostring(root, encoding="unicode", xml_declaration=True)


def _write_attributes(measure, time_signature, tuning):
    attributes = ET.SubElement(measure, "attributes")
    ET.SubElement(attributes, "divisions").text = str(DIVISIONS)
    time = ET.SubElement(attributes, "time")
    ET.SubElement(time, "beats").text = str(time_signature.get("numerator", 4))
    ET.SubElement(time, "beat-type").text = str(time_signature.get("denominator", 4))
    clef = ET.SubElement(attributes, "clef")
    ET.SubElement(clef, "sign").text = "TAB"
    ET.SubElement(clef, "line").text = "5"
    details = ET.SubElement(attributes, "staff-details")
    ET.SubElement(details, "staff-lines").text = "5"
    for line, midi in enumerate(tuning, start=1):
        staff_tuning = ET.SubElement(details, "staff-tuning", line=str(line))
        step, alter, octave = _midi_pitch(midi)
        ET.SubElement(staff_tuning, "tuning-step").text = step
        if alter:
            ET.SubElement(staff_tuning, "tuning-alter").text = str(alter)
        ET.SubElement(staff_tuning, "tuning-octave").text = str(octave)


def _write_words(measure, value, position):
    direction = ET.SubElement(measure, "direction", placement="above")
    direction_type = ET.SubElement(direction, "direction-type")
    ET.SubElement(direction_type, "words").text = value
    if position:
        ET.SubElement(direction, "offset").text = str(_pdf_position_to_xml(position))


def _write_harmony(measure, value, position):
    match = re.fullmatch(r"([A-G])([#b]?)(?:\s+(.*))?", value.strip())
    if not match:
        return
    harmony = ET.SubElement(measure, "harmony")
    root = ET.SubElement(harmony, "root")
    ET.SubElement(root, "root-step").text = match.group(1)
    if match.group(2):
        ET.SubElement(root, "root-alter").text = "1" if match.group(2) == "#" else "-1"
    suffix = (match.group(3) or "").casefold()
    kind = "minor" if suffix in {"min", "m"} else "major" if suffix in {"maj", "m"} else "other"
    ET.SubElement(harmony, "kind").text = kind
    if position:
        ET.SubElement(harmony, "offset").text = str(_pdf_position_to_xml(position))


def _write_rest(measure, duration):
    note = ET.SubElement(measure, "note")
    ET.SubElement(note, "rest")
    ET.SubElement(note, "duration").text = str(duration)
    ET.SubElement(note, "type").text = _duration_type(duration)


def _write_note(measure, source, duration, tuning, chord, technique, fingering):
    note = ET.SubElement(measure, "note")
    if chord:
        ET.SubElement(note, "chord")
    pitch = ET.SubElement(note, "pitch")
    step, alter, octave = _midi_pitch(tuning[source["string"]] + source["fret"])
    ET.SubElement(pitch, "step").text = step
    if alter:
        ET.SubElement(pitch, "alter").text = str(alter)
    ET.SubElement(pitch, "octave").text = str(octave)
    ET.SubElement(note, "duration").text = str(duration)
    ET.SubElement(note, "type").text = _duration_type(duration)
    notations = ET.SubElement(note, "notations")
    technical = ET.SubElement(notations, "technical")
    ET.SubElement(technical, "string").text = str(source["string"] + 1)
    ET.SubElement(technical, "fret").text = str(source["fret"])
    if source.get("dead"):
        ET.SubElement(note, "notehead").text = "x"
    if fingering:
        if fingering == "T":
            ET.SubElement(technical, "other-technical").text = "TEF fingering T"
        else:
            marker = ET.SubElement(technical, "fingering", enclosure="circle")
            marker.text = fingering
    if technique:
        marker = ET.SubElement(technical, technique["xml_type"], type=technique["marker_type"])
        if technique["marker_type"] == "start":
            marker.text = technique["label"]


def _techniques_by_note(score, notes):
    result = {}
    for technique in score.get("techniques", []):
        if technique.get("type") not in {"hammer-on", "pull-off", "slide", "bend"}:
            continue
        key = (technique.get("measure"), technique.get("position"), technique.get("string"))
        current = next((note for note in notes if _note_key(note) == key), None)
        if not current:
            continue
        following = next(
            (
                note for note in notes
                if note.get("string") == current.get("string")
                and (note.get("measure"), note.get("position")) > (current.get("measure"), current.get("position"))
            ),
            None,
        )
        if not following:
            continue
        if technique["type"] == "hammer-on" and current["fret"] >= following["fret"]:
            continue
        if technique["type"] == "pull-off" and current["fret"] <= following["fret"]:
            continue
        xml_type = "hammer-on" if technique["type"] == "hammer-on" else "pull-off" if technique["type"] == "pull-off" else technique["type"]
        result[key] = {"xml_type": xml_type, "marker_type": "start", "label": technique.get("label", technique["type"])}
        result[_note_key(following)] = {"xml_type": xml_type, "marker_type": "stop", "label": ""}
    return result


def _fingerings_by_note(score):
    return {
        (item.get("measure"), item.get("position"), item.get("string")): item.get("value")
        for item in score.get("fingerings", [])
    } | {
        (item.get("measure"), item.get("position"), item.get("string")): "T"
        for item in score.get("techniques", [])
        if item.get("type") == "thumb"
    }


def _metadata_by_measure(items):
    result = {}
    for item in items:
        result.setdefault(item.get("measure", 0), []).append(item)
    return result


def _note_key(note):
    return note.get("measure"), note.get("position"), note.get("string")


def _pdf_position_to_xml(position):
    return max(0, min(MEASURE_TICKS, round(position * MEASURE_TICKS / PDF_MEASURE_TICKS)))


def _duration_type(duration):
    return {240: "16th", 480: "eighth", 960: "quarter", 1920: "half", 3840: "whole"}.get(duration, "eighth")


def _parse_tuning(label):
    tokens = re.findall(r"[A-Ga-g](?:#|b|♭)?", label or "")
    if len(tokens) != 5:
        return DEFAULT_TUNING
    octaves = [4, 3, 3, 4, 4]
    return [_pitch_from_token(token, octaves[index]) for index, token in enumerate(tokens)]


def _pitch_from_token(token, octave):
    step = token[0].upper()
    alter = 1 if len(token) > 1 and token[1] == "#" else -1 if len(token) > 1 else 0
    return (octave + 1) * 12 + PITCHES[step] + alter


def _midi_pitch(midi):
    pitch_class = midi % 12
    names = [("C", 0), ("C", 1), ("D", 0), ("D", 1), ("E", 0), ("F", 0), ("F", 1), ("G", 0), ("G", 1), ("A", 0), ("A", 1), ("B", 0)]
    step, alter = names[pitch_class]
    return step, alter, midi // 12 - 1
