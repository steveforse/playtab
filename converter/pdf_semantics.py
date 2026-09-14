"""Compare normalized score models produced by PDF and TEF importers."""

from collections import Counter
from difflib import SequenceMatcher
from xml.etree import ElementTree as ET


def compare_scores(reference, candidate):
    """Return reviewable semantic comparison metrics for two score models.

    The comparison deliberately reports overlap rather than declaring every
    difference a parser failure.  A PDF can represent a repeated or laid-out
    version of a TEF score with different written measure boundaries.
    """
    reference_notes = _notes(reference)
    candidate_notes = _notes(candidate)
    reference_visible = Counter(_visible_key(note) for note in reference_notes)
    candidate_visible = Counter(_visible_key(note) for note in candidate_notes)
    reference_positioned = Counter(_positioned_key(note) for note in reference_notes)
    candidate_positioned = Counter(_positioned_key(note) for note in candidate_notes)

    visible_overlap = _overlap(reference_visible, candidate_visible)
    positioned_overlap = _overlap(reference_positioned, candidate_positioned)
    reference_sequence = [_sequence_key(note) for note in reference_notes]
    candidate_sequence = [_sequence_key(note) for note in candidate_notes]

    return {
        "measures": {
            "reference": reference.get("measures", 0),
            "candidate": candidate.get("measures", 0),
            "delta": candidate.get("measures", 0) - reference.get("measures", 0),
        },
        "notes": {
            "reference": len(reference_notes),
            "candidate": len(candidate_notes),
            "delta": len(candidate_notes) - len(reference_notes),
            "visible_overlap": visible_overlap,
            "positioned_overlap": positioned_overlap,
            "sequence_similarity": round(
                SequenceMatcher(None, reference_sequence, candidate_sequence, autojunk=False).ratio(),
                4,
            ),
        },
        "metadata": {
            "sections": _metadata_comparison(reference, candidate, "sections", "texts", "text"),
            "chords": _metadata_comparison(reference, candidate, "chords", "chords", "name"),
            "techniques": _metadata_comparison(reference, candidate, "techniques", "techniques", "type"),
            "fingerings": _metadata_comparison(reference, candidate, "fingerings", "fingerings", "value"),
            "lyrics": {
                "reference": bool(reference.get("lyrics") or reference.get("lyrics_text")),
                "candidate": bool(candidate.get("lyrics") or candidate.get("lyrics_text")),
            },
        },
    }


def musicxml_to_score(xml):
    """Read the note/timing subset emitted by the PDF MusicXML builder."""
    root = ET.fromstring(xml)
    measures = root.findall("./part/measure")
    score = {
        "measures": len(measures),
        "notes": [],
        "sections": [],
        "chords": [],
        "lyrics": root.findtext("./identification/miscellaneous/miscellaneous-field[@name='playtab-lyrics']"),
    }
    for measure_index, measure in enumerate(measures):
        cursor = 0
        last_position = 0
        for direction in measure.findall("./direction"):
            words = direction.findtext("./direction-type/words")
            if words:
                score["sections"].append({"measure": measure_index, "position": _xml_offset(direction), "text": words})
        for harmony in measure.findall("./harmony"):
            root_step = harmony.findtext("./root/root-step")
            if root_step:
                kind = harmony.findtext("./kind")
                score["chords"].append({
                    "measure": measure_index,
                    "position": _xml_offset(harmony),
                    "name": f"{root_step} {'min' if kind == 'minor' else 'Maj' if kind == 'major' else ''}".strip(),
                })
        for node in measure.findall("./note"):
            duration = int(node.findtext("duration", "0"))
            is_chord = node.find("chord") is not None
            position = last_position if is_chord else cursor
            technical = node.find("./notations/technical")
            if technical is not None and technical.findtext("string") and technical.findtext("fret"):
                score["notes"].append({
                    "measure": measure_index,
                    "position": round(position * 1024 / 3840),
                    "string": int(technical.findtext("string")) - 1,
                    "fret": int(technical.findtext("fret")),
                    "dead": node.findtext("notehead") == "x",
                })
            if not is_chord:
                last_position = cursor
                cursor += duration
    return score


def _notes(score):
    return sorted(
        score.get("notes", []),
        key=lambda note: (
            note.get("measure", 0),
            note.get("position", 0),
            note.get("string", 0),
            note.get("fret", 0),
            bool(note.get("dead")),
        ),
    )


def _visible_key(note):
    return (
        note.get("measure", 0),
        note.get("string", 0),
        note.get("fret", 0),
        bool(note.get("dead")),
    )


def _positioned_key(note):
    return _visible_key(note)[:1] + (note.get("position", 0),) + _visible_key(note)[1:]


def _sequence_key(note):
    return note.get("string", 0), note.get("fret", 0), bool(note.get("dead"))


def _overlap(reference, candidate):
    matched = sum((reference & candidate).values())
    reference_count = sum(reference.values())
    candidate_count = sum(candidate.values())
    return {
        "matched": matched,
        "reference": reference_count,
        "candidate": candidate_count,
        "recall": round(matched / reference_count, 4) if reference_count else 1.0,
        "precision": round(matched / candidate_count, 4) if candidate_count else 1.0,
        "exact": reference == candidate,
    }


def _metadata_comparison(reference, candidate, candidate_key, reference_key, value_key):
    reference_values = Counter(
        _metadata_value(item, value_key)
        for item in reference.get(reference_key, [])
        if _metadata_value(item, value_key)
    )
    candidate_values = Counter(
        _metadata_value(item, value_key)
        for item in candidate.get(candidate_key, [])
        if _metadata_value(item, value_key)
    )
    return _overlap(reference_values, candidate_values)


def _metadata_value(item, key):
    return str(item.get(key, "")).strip().casefold()


def _xml_offset(node):
    offset = int(node.findtext("offset", "0"))
    return round(offset * 1024 / 3840)
