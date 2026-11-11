"""P8: real pictures only.

Every non-null `symbol_id` must be the ID of a pictogram in the symbol index
(`config.SYMBOL_INDEX_PATH`, built by scripts/build_symbol_index.py). A line
with `symbol_id: None` has no picture and passes (R4.2). IDs are compared as
exact strings, so "2239" passes and " 2239" or "2239.0" fail.

The index is loaded once per process.

This module never logs, and `details` hold line IDs only, never text (R7.4).
"""
import json
from functools import lru_cache

from checks.config import SYMBOL_INDEX_PATH
from checks.models import CheckResult, KeyFact, Line


@lru_cache(maxsize=1)
def symbol_ids() -> frozenset[str]:
    """The IDs of every pictogram in the symbol index."""
    entries = json.loads(SYMBOL_INDEX_PATH.read_text(encoding="utf-8"))
    return frozenset(entry["id"] for entry in entries)


def check_p8(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    """Fail every line whose `symbol_id` is not in the symbol index.

    `original` and `key_facts` are unused. They are kept so every checker has
    the same signature.
    """
    del original, key_facts
    known = symbol_ids()
    failing = [line.id for line in lines if line.symbol_id is not None and line.symbol_id not in known]
    return CheckResult(
        rule="P8",
        passed=not failing,
        line_ids=failing,
        failed_fact_ids=[],
        details=[f"{line_id} has a symbol ID that is not in the symbol index" for line_id in failing],
    )
