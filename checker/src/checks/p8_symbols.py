"""P8: every non-null `symbol_id` is an ID in the symbol index.

IDs are compared as exact strings, so " 2239" and "2239.0" fail.
"""

import json
from functools import lru_cache

from checks.config import SYMBOL_INDEX_PATH
from checks.models import CheckResult, KeyFact, Line
from checks.results import line_result


@lru_cache(maxsize=1)
def symbol_ids() -> frozenset[str]:
    entries = json.loads(SYMBOL_INDEX_PATH.read_text(encoding="utf-8"))
    return frozenset(entry["id"] for entry in entries)


def check_p8(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    del original, key_facts
    known = symbol_ids()
    failing = [line.id for line in lines if line.symbol_id is not None and line.symbol_id not in known]
    return line_result(
        "P8",
        failing,
        [f"{line_id} has a symbol ID that is not in the symbol index" for line_id in failing],
    )
