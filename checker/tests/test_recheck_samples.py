"""Tests for scripts/recheck_samples.py (offline re-check of recorded samples)."""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path

import pytest

from checks.sentences import split_sentences

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "recheck_samples.py"
_spec = importlib.util.spec_from_file_location("recheck_samples", SCRIPT)
rs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rs)

ORIGINAL = "You must pay £45 by 1 April 2026. We have received your form and we will respond soon."
SAMPLE = {
    "result": {
        "original": {
            "text": ORIGINAL,
            "sentences": [s.model_dump() for s in split_sentences(ORIGINAL)],
        },
        "lines": [
            {"id": "L1", "text": "You must pay £45 by 1 April 2026.", "source_sentence_id": "s1", "symbol_id": None},
            {"id": "L2", "text": "We got your form and we will reply soon.", "source_sentence_id": "s2", "symbol_id": None},
        ],
    }
}


def test_recheck_counts_failing_lines_per_rule() -> None:
    line_count, rules = rs.recheck(SAMPLE)
    assert line_count == 2
    assert [rule for rule, _ in rules] == [f"P{n}" for n in range(1, 9)]
    assert dict(rules)["P1"] == []
    assert dict(rules)["P3"] == ["L2"]


def test_output_holds_ids_and_counts_only(tmp_path: Path, capsys) -> None:
    (tmp_path / "invented.json").write_text(json.dumps(SAMPLE), encoding="utf-8")
    assert rs.main(["--explain", "--samples", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "invented: 2 lines" in out
    assert "P3: L2" in out
    for line in SAMPLE["result"]["lines"]:
        assert line["text"] not in out
    for word in ("pay", "form", "£45", "2026"):
        assert word not in out


def test_a_sample_that_matches_the_current_split_has_no_drift() -> None:
    assert rs.sentence_drift(SAMPLE) == ([], [])


def test_reports_line_source_ids_missing_from_the_current_split(tmp_path: Path, capsys) -> None:
    """Regression: after a splitter change, lines pointed at sentence IDs that no
    longer existed, and this script still printed clean numbers."""
    sample = copy.deepcopy(SAMPLE)
    sample["result"]["lines"][1]["source_sentence_id"] = "s9"
    assert rs.sentence_drift(sample) == (["s9"], [])
    (tmp_path / "invented.json").write_text(json.dumps(sample), encoding="utf-8")
    assert rs.main(["--samples", str(tmp_path)]) == 1
    out = capsys.readouterr().out
    assert "invented: OUTDATED, 1 line source IDs not in the current split (s9)" in out
    assert "npm run record-samples" in out


def test_reports_recorded_sentences_whose_text_changed(tmp_path: Path, capsys) -> None:
    """Shifted IDs trace lines to the wrong source sentence even when every ID
    still exists, so a changed or extra sentence is reported too."""
    sample = copy.deepcopy(SAMPLE)
    sentences = sample["result"]["original"]["sentences"]
    merged = {"id": "s1", "text": ORIGINAL, "start": 0, "end": len(ORIGINAL)}
    sample["result"]["original"]["sentences"] = [merged]
    for line in sample["result"]["lines"]:
        line["source_sentence_id"] = "s1"
    assert rs.sentence_drift(sample) == ([], ["s1", "s2"])
    (tmp_path / "invented.json").write_text(json.dumps(sample), encoding="utf-8")
    assert rs.main(["--samples", str(tmp_path)]) == 1
    out = capsys.readouterr().out
    assert "2 recorded sentences changed" in out
    for s in sentences:
        assert s["text"] not in out


@pytest.mark.parametrize("path", sorted(rs.SAMPLES_DIR.glob("*.json")), ids=lambda p: p.stem)
def test_recorded_samples_match_the_current_sentence_split(path: Path) -> None:
    """A checker change that moves sentence IDs breaks the recorded samples
    (the web app answers `sample_outdated`). Re-record them with
    `cd web && npm run record-samples`, never by editing the IDs by hand."""
    missing, changed = rs.sentence_drift(json.loads(path.read_text(encoding="utf-8")))
    assert (len(missing), len(changed)) == (0, 0), "sample is outdated: run cd web && npm run record-samples"
