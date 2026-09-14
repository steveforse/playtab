"""Recognize the positioned text and tablature geometry in TablEdit PDFs.

The Brainjo PDFs are vector PDFs.  Their note glyphs are selectable text and
their five staff lines and bar lines are drawing commands.  This recognizer
uses those two sources together; it does not treat the PDF's reading order as
the score order.

This is deliberately a bounded, reviewable recognizer.  A PDF is a rendered
document, so information such as exact duration codes may not be recoverable
from it even when every visible fret is recoverable.
"""

from io import BytesIO
import logging
import re
import warnings

try:
    from pypdf import PdfReader
except ImportError as error:  # pragma: no cover - exercised by deployment
    PdfReader = None
    _PYPDF_ERROR = error


MAX_PDF_SIZE = 10_000_000
MAX_PAGES = 64
MEASURE_TICKS = 1024
POSITION_STEP = 128
POSITION_LEFT_MARGIN_RATIO = 0.08
POSITION_RIGHT_MARGIN_RATIO = 0.02

SECTION_LABELS = {
    "intro", "verse", "verses", "chorus", "bridge", "high solo", "low solo",
    "solo", "outro", "tag", "break", "ending",
}
TECHNIQUE_LABELS = {
    "h": "hammer-on",
    "ho": "hammer-on",
    "hammeron": "hammer-on",
    "po": "pull-off",
    "pulloff": "pull-off",
    "p/o": "pull-off",
    "slide": "slide",
    "sl": "slide",
    "s": "slide",
    "bend": "bend",
    "b": "bend",
    "t": "thumb",
    "thumb": "thumb",
}


class PdfRecognitionError(ValueError):
    """Raised when a PDF cannot be recognized safely."""


def _transform(matrix, x, y):
    return (
        matrix[0] * x + matrix[2] * y + matrix[4],
        matrix[1] * x + matrix[3] * y + matrix[5],
    )


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _unique_sorted(values, tolerance=2.0):
    result = []
    for value in sorted(values):
        if not result or abs(value - result[-1]) > tolerance:
            result.append(value)
    return result


class PdfRecognizer:
    """Extract a bounded score model from a vector tablature PDF."""

    def recognize(self, data, filename=""):
        if not isinstance(data, (bytes, bytearray)):
            raise PdfRecognitionError("PDF upload is not binary data.")
        if not 1 <= len(data) <= MAX_PDF_SIZE:
            raise PdfRecognitionError("PDF upload is empty or too large.")
        if not data.startswith(b"%PDF-"):
            raise PdfRecognitionError("This file is not a PDF.")
        if PdfReader is None:  # pragma: no cover - deployment configuration
            raise PdfRecognitionError(f"PDF support is unavailable: {_PYPDF_ERROR}")

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            logging.getLogger("pypdf").setLevel(logging.ERROR)
            try:
                reader = PdfReader(BytesIO(data), strict=False)
            except Exception as error:
                raise PdfRecognitionError("This PDF could not be read safely.") from error

        if not 1 <= len(reader.pages) <= MAX_PAGES:
            raise PdfRecognitionError("PDF page count is outside the supported range.")

        pages = []
        for page_index, page in enumerate(reader.pages):
            page_data = self._read_page(page)
            for system in page_data["systems"]:
                system["page"] = page_index
            pages.append(page_data)
        systems = [system for page in pages for system in page["systems"]]
        systems.sort(key=lambda system: (system["page"], -system["bottom"]))
        if not systems:
            raise PdfRecognitionError(
                "No five-line tablature systems were found. This PDF may be a scan or an unsupported layout."
            )

        notes = []
        measure_index = 0
        timing_steps = set()
        for system in systems:
            system["measure_start"] = measure_index
            bars = system["bars"]
            for measure_offset, (left, right) in enumerate(zip(bars, bars[1:])):
                events = [
                    event
                    for event in system["events"]
                    if left + 5 <= event["x"] < right - 2
                ]
                event_xs = [item["x"] for item in events]
                step = self._position_step(left, right, event_xs)
                timing_steps.add(step)
                for event in events:
                    position = self._position(event["x"], left, right, step=step)
                    for note in event["notes"]:
                        notes.append(
                            {
                                "measure": measure_index + measure_offset,
                                "position": position,
                                "string": note["string"],
                                "fret": note["fret"],
                                "dead": note["dead"],
                            }
                        )
            measure_index += max(0, len(bars) - 1)

        if not notes:
            raise PdfRecognitionError("No tablature notes were recognized.")

        title, tuning = self._header(pages[0]["texts"])
        timing_name = "sixteenth-note" if any(step <= 64 for step in timing_steps) else "eighth-note"
        metadata = self._metadata(pages, systems)
        warnings_list = [
            f"PDF note timing is inferred from horizontal layout and rounded to the nearest {timing_name} position.",
            "PDF recognition cannot guarantee hidden TEF duration, voice, repeat, or source metadata fidelity.",
        ]
        if not tuning:
            warnings_list.append("The PDF tuning label was not recognized; review the imported tuning.")
        if not metadata["sections"]:
            warnings_list.append("No section labels were confidently associated with tablature measures.")
        if not metadata["chords"]:
            warnings_list.append("No chord names were confidently associated with tablature measures.")
        if not metadata["lyrics"]:
            warnings_list.append("No standalone lyric page was recognized.")
        if not metadata["techniques"]:
            warnings_list.append("No printed technique labels were confidently associated with notes.")
        if not metadata["fingerings"]:
            warnings_list.append("No printed fingering annotations were confidently associated with notes.")
        if not metadata["tempo"]:
            warnings_list.append("No printed tempo was found as selectable PDF text; review the imported tempo.")
        if metadata["chords"]:
            warnings_list.append("PDF chord names are preserved without chord voicings or diagrams.")
        skipped_techniques = sum(
            1 for technique in metadata["techniques"]
            if technique["type"] in {"hammer-on", "pull-off"} and not self._technique_pair_valid(technique, notes)
        )
        if skipped_techniques:
            warnings_list.append(f"{skipped_techniques} PDF legato mark(s) were not attached because the nearby frets did not confirm its direction.")

        return {
            "title": title or filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].rsplit(".", 1)[0],
            "tuning_label": tuning,
            "measures": measure_index,
            "time_signature": {"numerator": 4, "denominator": 4},
            "notes": notes,
            "tempo": metadata["tempo"],
            "sections": metadata["sections"],
            "chords": metadata["chords"],
            "lyrics": metadata["lyrics"],
            "techniques": metadata["techniques"],
            "fingerings": metadata["fingerings"],
            "warnings": warnings_list,
        }

    def _read_page(self, page):
        texts = []
        segments = []
        pending = None

        def visitor_operand_before(operator, args, matrix, _text_matrix):
            nonlocal pending
            name = operator.decode() if isinstance(operator, bytes) else str(operator)
            values = [_number(value) for value in args]
            if name == "m" and len(values) >= 2 and values[0] is not None and values[1] is not None:
                pending = _transform(matrix, values[0], values[1])
                return
            if name == "l" and len(values) >= 2 and pending and values[0] is not None and values[1] is not None:
                endpoint = _transform(matrix, values[0], values[1])
                x1, y1 = pending
                x2, y2 = endpoint
                if (
                    5 <= min(x1, x2) <= 607
                    and 5 <= max(x1, x2) <= 607
                    and 10 <= min(y1, y2) <= 782
                    and 10 <= max(y1, y2) <= 782
                ):
                    segments.append((x1, y1, x2, y2))
                pending = None
                return
            if name in {"S", "s", "f", "f*", "B", "B*", "b", "b*", "n"}:
                pending = None

        def visitor_text(text, matrix, text_matrix, _font_dict, _font_size):
            value = text.replace("\n", "").strip()
            if not value:
                return
            x, y = _transform(matrix, text_matrix[4], text_matrix[5])
            if 5 <= x <= 607 and 10 <= y <= 782:
                texts.append({"x": x, "y": y, "text": value})

        try:
            page.extract_text(
                visitor_text=visitor_text,
                visitor_operand_before=visitor_operand_before,
            )
        except Exception as error:
            raise PdfRecognitionError("A PDF page could not be read safely.") from error

        return {"texts": texts, "systems": self._systems(texts, segments)}

    def _systems(self, texts, segments):
        horizontal = []
        for x1, y1, x2, y2 in segments:
            if abs(y1 - y2) < 0.8 and abs(x2 - x1) >= 100:
                horizontal.append(((y1 + y2) / 2, min(x1, x2), max(x1, x2)))

        lines = []
        for y, start, end in sorted(horizontal):
            if not lines or abs(y - lines[-1][0]) > 0.8:
                lines.append([y, start, end])
            else:
                lines[-1][1] = min(lines[-1][1], start)
                lines[-1][2] = max(lines[-1][2], end)

        systems = []
        cursor = 0
        while cursor + 4 < len(lines):
            candidate = lines[cursor : cursor + 5]
            spacing = [candidate[index + 1][0] - candidate[index][0] for index in range(4)]
            if max(spacing) - min(spacing) > 1.5:
                cursor += 1
                continue
            start = max(line[1] for line in candidate)
            end = min(line[2] for line in candidate)
            if end - start < 100:
                cursor += 1
                continue

            top = candidate[0][0]
            bottom = candidate[-1][0]
            bars = []
            for x1, y1, x2, y2 in segments:
                if (
                    abs(x1 - x2) < 0.8
                    and min(y1, y2) <= top + 1
                    and max(y1, y2) >= bottom - 1
                ):
                    x = (x1 + x2) / 2
                    if start - 2 <= x <= end + 2:
                        bars.append(x)
            bars = _unique_sorted(bars)
            if len(bars) < 2:
                cursor += 5
                continue

            row_positions = [bottom - index * (bottom - top) / 4 for index in range(5)]
            note_text = []
            for item in texts:
                if not start + 10 <= item["x"] <= end - 2 or not top - 5 <= item["y"] <= bottom + 5:
                    continue
                nearest = min(range(5), key=lambda index: abs(item["y"] - row_positions[index]))
                if abs(item["y"] - row_positions[nearest] + 3.6) > 5:
                    continue
                value = item["text"]
                if re.fullmatch(r"\d{1,2}", value):
                    note_text.append(
                        {
                            "x": item["x"],
                            "y": item["y"],
                            "string": nearest,
                            "fret": int(value),
                            "dead": False,
                        }
                    )
                elif value.upper() == "X":
                    note_text.append(
                        {
                            "x": item["x"],
                            "y": item["y"],
                            "string": nearest,
                            "fret": 0,
                            "dead": True,
                        }
                    )

            events = []
            for note in sorted(note_text, key=lambda item: item["x"]):
                event = next((event for event in events if abs(event["x"] - note["x"]) < 3), None)
                if event is None:
                    events.append({"x": note["x"], "notes": [note]})
                else:
                    event["notes"].append(note)

            systems.append(
                {
                    "page": 0,
                    "top": top,
                    "bottom": bottom,
                    "bars": bars,
                    "events": events,
                    "texts": texts,
                }
            )
            cursor += 5

        return systems

    def _metadata(self, pages, systems):
        sections = []
        chords = []
        techniques = []
        fingerings = []
        for system in systems:
            page_texts = pages[system["page"]]["texts"]
            sections.extend(self._sections_for_system(system, page_texts))
            chords.extend(self._chords_for_system(system, page_texts))
            techniques.extend(self._techniques_for_system(system, page_texts))
            fingerings.extend(self._fingerings_for_system(system, page_texts))

        lyrics = self._lyrics(pages)
        tempo = self._tempo(pages)
        return {
            "sections": self._deduplicate_metadata(sections),
            "chords": self._deduplicate_metadata(chords),
            "lyrics": lyrics,
            "techniques": self._deduplicate_metadata(techniques),
            "fingerings": self._deduplicate_metadata(fingerings),
            "tempo": tempo,
        }

    @staticmethod
    def _deduplicate_metadata(items):
        result = []
        seen = set()
        for item in sorted(items, key=lambda value: (value.get("measure", 0), value.get("position", 0), value.get("text", value.get("type", "")))):
            key = tuple(sorted(item.items()))
            if key not in seen:
                seen.add(key)
                result.append(item)
        return result

    def _sections_for_system(self, system, texts):
        candidates = []
        for item in texts:
            label = re.sub(r"\s+", " ", item["text"]).strip()
            if not self._is_section_label(system, item, label):
                continue
            if not self._near_system(system, item["x"], item["y"], vertical=42):
                continue
            target = self._metadata_system_for_overflow(system, item["x"])
            measure, position = self._measure_position(target, item["x"])
            candidates.append({"measure": measure, "position": position, "text": label, "confidence": "high"})
        return candidates

    def _chords_for_system(self, system, texts):
        # Chord names are printed above a staff system.  TablEdit may split
        # flat symbols and suffixes into separate positioned text objects.
        candidates = [
            item for item in texts
            if system["bars"][0] - 18 <= item["x"] <= system["bars"][-1] + 18
            and system["bottom"] + 8 <= item["y"] <= system["bottom"] + 35
        ]
        groups = []
        for item in sorted(candidates, key=lambda value: (value["y"], value["x"])):
            group = next(
                (
                    group for group in groups
                    if abs(group[0]["y"] - item["y"]) <= 4.0
                    and item["x"] - group[-1]["x"] <= 20
                ),
                None,
            )
            if group is None:
                groups.append([item])
            else:
                group.append(item)

        result = []
        for group in groups:
            label = self._normalize_chord(" ".join(item["text"] for item in sorted(group, key=lambda value: value["x"])))
            if not label:
                continue
            item = group[0]
            measure, position = self._measure_position(system, item["x"])
            result.append({"measure": measure, "position": position, "name": label, "confidence": "high"})
        return result

    @staticmethod
    def _normalize_chord(value):
        value = value.replace("!", "b").replace("♭", "b").replace("♯", "#")
        value = re.sub(r"\s+", " ", value).strip()
        value = re.sub(r"^([A-Ga-g])\s+([#b])", r"\1\2", value)
        match = re.fullmatch(r"([A-Ga-g](?:[#b])?)(?:\s+(Maj|Min|maj|min|m|M|dim|aug|sus\d*))?", value)
        if not match:
            return ""
        root = match.group(1)[0].upper() + match.group(1)[1:]
        suffix = match.group(2)
        if suffix and suffix == "m":
            suffix = "min"
        return f"{root} {suffix}" if suffix else root

    def _techniques_for_system(self, system, texts):
        result = []
        for item in texts:
            label = item["text"].strip()
            technique = self._technique_type(label)
            if not technique or not self._near_system(system, item["x"], item["y"], vertical=42):
                continue
            note = self._nearest_note(system, item["x"])
            target = self._metadata_system_for_overflow(system, item["x"])
            if note is None:
                note = self._nearest_note(target, item["x"])
            if note is None:
                continue
            measure, position = self._measure_position(target, note["x"])
            result.append({
                "measure": measure,
                "position": position,
                "string": note["string"],
                "type": technique,
                "label": item["text"].strip(),
                "confidence": "medium" if technique in {"slide", "bend"} else "high",
            })
        return result

    def _fingerings_for_system(self, system, texts):
        result = []
        for item in texts:
            if not re.fullmatch(r"[1-4]", item["text"].strip()):
                continue
            if system["top"] - 8 <= item["y"] <= system["bottom"] + 8:
                continue
            if not system["top"] - 34 <= item["y"] <= system["bottom"] + 34:
                continue
            if not system["bars"][0] - 18 <= item["x"] <= system["bars"][-1] + 18:
                continue
            note = self._nearest_note(system, item["x"], limit=16)
            if note is None:
                continue
            measure, position = self._measure_position(system, note["x"])
            result.append({
                "measure": measure,
                "position": position,
                "string": note["string"],
                "value": item["text"].strip(),
                "confidence": "medium",
            })
        return result

    @staticmethod
    def _technique_pair_valid(technique, notes):
        current = next(
            (
                note for note in notes
                if note["measure"] == technique.get("measure")
                and note["position"] == technique.get("position")
                and note["string"] == technique.get("string")
            ),
            None,
        )
        if current is None:
            return False
        following = next(
            (
                note for note in notes
                if note["string"] == current["string"]
                and (note["measure"], note["position"]) > (current["measure"], current["position"])
            ),
            None,
        )
        if following is None:
            return False
        if technique["type"] == "hammer-on":
            return current["fret"] < following["fret"]
        return current["fret"] > following["fret"]

    @staticmethod
    def _technique_type(value):
        label = value.casefold().strip()
        return TECHNIQUE_LABELS.get(label) or TECHNIQUE_LABELS.get(re.sub(r"[\s._-]+", "", label))

    def _is_section_label(self, system, item, label):
        if label.casefold() in SECTION_LABELS:
            return True
        if item["y"] >= system["top"] - 8:
            return False
        if not 2 <= len(label) <= 32 or not re.search(r"[a-zA-Z]", label):
            return False
        if self._technique_type(label) or self._normalize_chord(label):
            return False
        if re.search(r"(?:page\s+\d|tuning|arranged|clawhammerbanjo|\.net)", label, re.IGNORECASE):
            return False
        return True

    @staticmethod
    def _near_system(system, x, y, vertical):
        return system["bars"][0] - 18 <= x <= system["bars"][-1] + 18 and system["top"] - vertical <= y <= system["bottom"] + vertical

    @staticmethod
    def _nearest_note(system, x, limit=24):
        notes = [note for event in system["events"] for note in event["notes"]]
        if not notes:
            return None
        note = min(notes, key=lambda value: abs(value["x"] - x))
        return note if abs(note["x"] - x) <= limit else None

    @staticmethod
    def _metadata_system_for_overflow(system, x):
        # Most labels are within their staff width.  A label just past the
        # right bar is printed for the first measure on the following row.
        return system

    @staticmethod
    def _measure_position(system, x):
        bars = system["bars"]
        measure_offset = max(0, min(len(bars) - 2, next((index for index, right in enumerate(bars[1:]) if x < right), len(bars) - 2)))
        left, right = bars[measure_offset], bars[measure_offset + 1]
        event_xs = [
            event["x"]
            for event in system["events"]
            if left + 5 <= event["x"] < right - 2
        ]
        step = PdfRecognizer._position_step(left, right, event_xs)
        return system["measure_start"] + measure_offset, PdfRecognizer._position(x, left, right, step=step)

    @staticmethod
    def _lyrics(pages):
        candidates = []
        for page in pages:
            if page["systems"]:
                continue
            body = [item for item in page["texts"] if item["y"] < 735 and item["y"] > 55 and item["x"] < 120]
            if len(body) >= 4:
                candidates.append(body)
        if not candidates:
            return None
        lines = sorted(candidates[0], key=lambda item: (-item["y"], item["x"]))
        return "\n".join(item["text"].strip() for item in lines if item["text"].strip()) or None

    @staticmethod
    def _tempo(pages):
        for page in pages:
            texts = page["texts"]
            for item in texts:
                value = item["text"]
                for pattern in (
                    r"(?:tempo|bpm)\s*[:=]?\s*(\d{2,3})",
                    r"(?:m\.?\s*m\.?|mm)\s*[:=]?\s*(\d{2,3})",
                    r"(?:quarter(?:\s+note)?|q|[♩♪♫])\s*(?:=|at)\s*(\d{2,3})",
                ):
                    match = re.search(pattern, value, re.IGNORECASE)
                    if match:
                        return int(match.group(1))

            # PDF producers sometimes emit the metronome symbol and its
            # number as separate text objects.  Reconnect nearby objects
            # without treating an unrelated page number as a tempo.
            for symbol in texts:
                if not re.search(r"(?:quarter|metronome|[♩♪♫])", symbol["text"], re.IGNORECASE):
                    continue
                for number in texts:
                    if not re.fullmatch(r"\d{2,3}", number["text"]):
                        continue
                    if abs(symbol["y"] - number["y"]) <= 6 and 0 < number["x"] - symbol["x"] <= 96:
                        return int(number["text"])
        return None

    @staticmethod
    def _position_step(left, right, event_xs):
        unique_xs = sorted(set(event_xs or []))
        if len(unique_xs) < 2:
            return POSITION_STEP
        smallest_gap = min(
            gap for gap in (right_x - left_x for left_x, right_x in zip(unique_xs, unique_xs[1:]))
            if gap > 1.5
        )
        subdivisions = (right - left) / smallest_gap
        if subdivisions >= 24:
            return 32
        if subdivisions >= 12:
            return 64
        return POSITION_STEP

    @staticmethod
    def _position(x, left, right, event_xs=None, step=None):
        width = right - left
        left_margin = min(12.0, max(6.0, width * POSITION_LEFT_MARGIN_RATIO))
        right_margin = min(4.0, max(2.0, width * POSITION_RIGHT_MARGIN_RATIO))
        usable = max(1.0, width - left_margin - right_margin)
        raw = ((x - left - left_margin) / usable) * MEASURE_TICKS
        step = step or PdfRecognizer._position_step(left, right, event_xs or [])
        return max(0, min(MEASURE_TICKS - step, round(raw / step) * step))

    @staticmethod
    def _header(texts):
        top = [item for item in texts if item["y"] > 735]
        title = next(
            (
                item["text"]
                for item in sorted(top, key=lambda item: item["y"], reverse=True)
                if "tuning" not in item["text"].lower()
                and "arranged" not in item["text"].lower()
                and "clawhammerbanjo" not in item["text"].lower()
            ),
            "",
        )
        header = " ".join(item["text"] for item in sorted(top, key=lambda item: item["x"]))
        match = re.search(r"([a-gA-G][a-gA-G#b♭]{4,})\s+tuning", header)
        return title, match.group(1) if match else ""


def recognize(data, filename=""):
    return PdfRecognizer().recognize(data, filename=filename)
