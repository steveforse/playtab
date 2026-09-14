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
        for system in systems:
            bars = system["bars"]
            for measure_offset, (left, right) in enumerate(zip(bars, bars[1:])):
                events = [
                    event
                    for event in system["events"]
                    if left + 5 <= event["x"] < right - 2
                ]
                for event in events:
                    position = self._position(event["x"], left, right)
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
        warnings_list = [
            "PDF note timing is inferred from horizontal layout and rounded to the nearest eighth-note position.",
            "PDF recognition cannot guarantee hidden TEF duration, voice, repeat, or source metadata fidelity.",
        ]
        if not tuning:
            warnings_list.append("The PDF tuning label was not recognized; review the imported tuning.")

        return {
            "title": title or filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].rsplit(".", 1)[0],
            "tuning_label": tuning,
            "measures": measure_index,
            "time_signature": {"numerator": 4, "denominator": 4},
            "notes": notes,
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
                            "string": nearest,
                            "fret": int(value),
                            "dead": False,
                        }
                    )
                elif value.upper() == "X":
                    note_text.append(
                        {
                            "x": item["x"],
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

    @staticmethod
    def _position(x, left, right):
        width = right - left
        margin = min(12.0, max(6.0, width * 0.07))
        usable = max(1.0, width - margin)
        raw = ((x - left - margin) / usable) * MEASURE_TICKS
        return max(0, min(MEASURE_TICKS - POSITION_STEP, round(raw / POSITION_STEP) * POSITION_STEP))

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
