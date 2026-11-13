"""Tests for scripts/run_matching_test.py (the on-save hook)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "run_matching_test.py"
_spec = importlib.util.spec_from_file_location("run_matching_test", SCRIPT)
rmt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rmt)


@pytest.mark.parametrize(
    "saved, expected",
    [
        ("checker/src/checks/p2_sentence_length.py", "tests/test_p2_sentence_length.py"),
        ("/abs/repo/checker/src/checks/p8_symbols.py", "tests/test_p8_symbols.py"),
        ("checker/src/checks/key_facts.py", "tests/test_key_facts.py"),
        ("checker/src/checks/sentences.py", "tests/test_sentences.py"),
        ("checker/src/checks/config.py", None),
        ("checker/src/checks/wordlist/common.txt", None),
        ("web/src/pipeline/run.ts", None),
        (None, None),
    ],
)
def test_matching_test(saved: str | None, expected: str | None) -> None:
    assert rmt.matching_test(saved) == expected


def test_path_from_argv_wins() -> None:
    assert rmt.saved_path(["checker/src/checks/p6_digits.py"], '{"file_path": "x"}') == (
        "checker/src/checks/p6_digits.py"
    )


@pytest.mark.parametrize(
    "event",
    [
        {"hook_event_name": "PostFileSave", "file_path": "/r/checker/src/checks/p6_digits.py"},
        {"cwd": "/r", "tool_input": {"path": "/r/checker/src/checks/p6_digits.py"}},
        {"files": ["/r/checker/src/checks/p6_digits.py"]},
    ],
)
def test_path_from_stdin_event(event: dict) -> None:
    assert rmt.saved_path([], json.dumps(event)) == "/r/checker/src/checks/p6_digits.py"


def test_no_path_means_full_suite() -> None:
    assert rmt.saved_path([], "") is None
    assert rmt.matching_test(rmt.saved_path([], '{"cwd": "/r"}')) is None
