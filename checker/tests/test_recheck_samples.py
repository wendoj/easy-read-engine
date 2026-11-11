"""Tests for scripts/recheck_samples.py (offline re-check of recorded samples)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "recheck_samples.py"
_spec = importlib.util.spec_from_file_location("recheck_samples", SCRIPT)
rs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rs)

ORIGINAL = "You must pay £45 by 1 April 2026. We have received your form and we will respond soon."
SAMPLE = {
    "result": {
        "original": {"text": ORIGINAL},
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
