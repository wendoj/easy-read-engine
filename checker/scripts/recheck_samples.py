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

It also compares the recorded sentences with the current sentence split. The
web app refuses a sample (`sample_outdated`) when a line's
`source_sentence_id` is no longer a sentence, and a sentence whose text
changed traces lines to the wrong source. Either way the sample needs
`cd web && npm run record-samples`.

Exit code 1 when any sample is outdated in this way, else 0. The rule numbers
are for measuring, not a gate.
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


def sentence_drift(sample: dict) -> tuple[list[str], list[str]]:
    """Sentence IDs the recorded lines use that the current split doesn't have,
    and recorded sentence IDs whose text or offsets differ from the current split."""
    result = sample["result"]
    current = {s.id: (s.text, s.start, s.end) for s in analyse(result["original"]["text"]).sentences}
    used = {line["source_sentence_id"] for line in result["lines"]}
    missing = sorted(used - current.keys(), key=_id_order)
    recorded = result["original"].get("sentences", [])
    changed = [
        s["id"] for s in recorded if current.get(s["id"]) != (s["text"], s["start"], s["end"])
    ]
    changed += sorted(current.keys() - {s["id"] for s in recorded}, key=_id_order)
    return missing, changed


def _id_order(sentence_id: str) -> tuple[int, str]:
    digits = sentence_id.lstrip("s")
    return (int(digits), "") if digits.isdigit() else (0, sentence_id)


def format_drift(sample_id: str, missing: list[str], changed: list[str]) -> list[str]:
    if not missing and not changed:
        return []
    return [
        f"{sample_id}: OUTDATED, {len(missing)} line source IDs not in the current split "
        f"({', '.join(missing) or 'none'}), {len(changed)} recorded sentences changed. "
        "Run: cd web && npm run record-samples"
    ]


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
    outdated = False
    for path in paths:
        sample = json.loads(path.read_text(encoding="utf-8"))
        line_count, rules = recheck(sample)
        print("\n".join(format_report(path.stem, line_count, rules, args.explain)))
        drift = format_drift(path.stem, *sentence_drift(sample))
        if drift:
            outdated = True
            print("\n".join(drift))
    return 1 if outdated else 0


if __name__ == "__main__":
    sys.exit(main())
