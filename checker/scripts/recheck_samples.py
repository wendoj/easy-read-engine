"""Re-check the recorded sample letters offline with the current checker.

    cd checker && uv run python scripts/recheck_samples.py [--explain] [SAMPLE_ID ...]

For each `web/data/samples/<id>.json` (or only the IDs given), this does what
the web app does when it loads a sample (`web/src/samples/handler.ts`
`recheckSample`): it analyses the recorded Original text and runs P1 to P8 on
the recorded lines. No model is called. P9 and P10 need a model and are left
out.

It prints, per sample, the line count and the number of failing lines per
rule. `--explain` also prints the failing line IDs per rule. It never prints
letter text, Easy Read lines or key-fact values (R7.4).

Exit code 0 always: the numbers are for measuring, not a gate.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

CHECKER_DIR = Path(__file__).resolve().parents[1]
SAMPLES_DIR = CHECKER_DIR.parent / "web" / "data" / "samples"
sys.path.insert(0, str(CHECKER_DIR / "src"))

from checks import analyse, check_easy_read  # noqa: E402
from checks.models import Line  # noqa: E402


def recheck(sample: dict) -> tuple[int, list[tuple[str, list[str]]]]:
    """Line count and (rule, failing line IDs) for P1 to P8 of one recorded sample."""
    result = sample["result"]
    original = result["original"]["text"]
    lines = [Line.model_validate(line) for line in result["lines"]]
    key_facts = analyse(original).key_facts
    checks = check_easy_read(original, key_facts, lines)
    return len(lines), [(c.rule, [] if c.passed else list(c.line_ids)) for c in checks]


def format_report(sample_id: str, line_count: int, rules: list[tuple[str, list[str]]], explain: bool) -> list[str]:
    counts = " ".join(f"{rule} {len(ids)}" for rule, ids in rules)
    out = [f"{sample_id}: {line_count} lines, failing lines: {counts}"]
    if explain:
        out += [f"  {rule}: {', '.join(ids)}" for rule, ids in rules if ids]
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("ids", nargs="*", help="sample IDs (default: all)")
    parser.add_argument("--explain", action="store_true", help="also print failing line IDs")
    parser.add_argument("--samples", type=Path, default=SAMPLES_DIR)
    args = parser.parse_args(argv)

    paths = [args.samples / f"{i}.json" for i in args.ids] or sorted(args.samples.glob("*.json"))
    for path in paths:
        line_count, rules = recheck(json.loads(path.read_text(encoding="utf-8")))
        print("\n".join(format_report(path.stem, line_count, rules, args.explain)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
