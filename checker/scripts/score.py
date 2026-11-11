"""Small CLI over the checker functions, for the day 1 spike (task 8).

Reads one JSON object on stdin and writes one JSON object on stdout. Nothing
is logged and nothing is written to disk (R7.4).

    uv run python scripts/score.py analyse   # {"original"} -> {"sentences", "key_facts"}
    uv run python scripts/score.py score     # {"original", "lines"} -> {"key_fact_count", "results"}

`score` extracts key facts from the Original itself, so P1 compares the output
with the Original and never with anything the model returned (R2.4). Lines use
the checker's field names: {"id", "text", "source_sentence_id", "symbol_id"}.
Only P1, P2 and P4 exist so far.
"""

import json
import sys

from pydantic import BaseModel

from checks.key_facts import extract_key_facts
from checks.models import Line
from checks.p1_key_facts import check_p1
from checks.p2_sentence_length import check_p2
from checks.p4_passive import check_p4
from checks.sentences import split_sentences

CHECKERS = (check_p1, check_p2, check_p4)


class AnalyseInput(BaseModel):
    original: str


class ScoreInput(BaseModel):
    original: str
    lines: list[Line]


def analyse(raw: str) -> dict:
    data = AnalyseInput.model_validate_json(raw)
    sentences = split_sentences(data.original)
    facts = extract_key_facts(data.original, sentences)
    return {
        "sentences": [s.model_dump() for s in sentences],
        "key_facts": [f.model_dump() for f in facts],
    }


def score(raw: str) -> dict:
    data = ScoreInput.model_validate_json(raw)
    facts = extract_key_facts(data.original, split_sentences(data.original))
    results = [check(data.original, facts, data.lines) for check in CHECKERS]
    return {"key_fact_count": len(facts), "results": [r.model_dump() for r in results]}


COMMANDS = {"analyse": analyse, "score": score}


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        print(f"usage: score.py {{{'|'.join(COMMANDS)}}} < input.json", file=sys.stderr)
        return 2
    try:
        out = COMMANDS[sys.argv[1]](sys.stdin.read())
    except ValueError as err:
        # Pydantic errors can echo input values, so report only the error type.
        print(f"invalid input: {type(err).__name__}", file=sys.stderr)
        return 1
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
