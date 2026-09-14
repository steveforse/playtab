#!/usr/bin/env python3
"""Compare private paired TEF/PDF recognition results.

The corpus and generated JSON files are intentionally kept under ignored
``tmp/``.  This script is a review tool, not a repository fixture or a
production upload endpoint.
"""

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "converter"))
from pdf_musicxml import build_musicxml  # noqa: E402
from pdf_semantics import compare_scores, musicxml_to_score  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=Path("tmp/pdf-corpus"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    manifest = _load(args.corpus / "manifest.json")
    tef_results = {item["id"]: item for item in _load(args.corpus / "tef-results.json")}
    pdf_results = {item["id"]: item for item in _load(args.corpus / "pdf-results.json")}
    entries = []
    summary = Counter()

    for item in manifest:
        tef = tef_results.get(item["id"], {})
        pdf = pdf_results.get(item["id"], {})
        if not tef.get("ok") or not pdf.get("ok"):
            summary["parse_failure"] += 1
            entries.append({"id": item["id"], "key": item["key"], "status": "parse_failure"})
            continue

        comparison = compare_scores(tef["parsed"], pdf["parsed"])
        generated = musicxml_to_score(build_musicxml(pdf["parsed"]))
        comparison["musicxml_roundtrip"] = compare_scores(pdf["parsed"], generated)
        summary["pairs"] += 1
        summary["measure_count_match"] += comparison["measures"]["delta"] == 0
        summary["visible_note_match"] += comparison["notes"]["visible_overlap"]["exact"]
        summary["positioned_note_match"] += comparison["notes"]["positioned_overlap"]["exact"]
        summary["musicxml_note_match"] += comparison["musicxml_roundtrip"]["notes"]["positioned_overlap"]["exact"]
        summary["section_match"] += comparison["metadata"]["sections"]["exact"]
        summary["chord_match"] += comparison["metadata"]["chords"]["exact"]
        entries.append({
            "id": item["id"],
            "key": item["key"],
            "tef_source": item.get("tef_source"),
            "pdf_source": item.get("pdf_source"),
            "status": "compared",
            "comparison": comparison,
        })

    report = {"summary": dict(summary), "entries": entries}
    output = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        args.output.write_text(output + "\n")

    print(json.dumps(report["summary"], sort_keys=True))
    return 0


def _load(path):
    return json.loads(path.read_text())


if __name__ == "__main__":
    raise SystemExit(main())
