"""P1: every key fact in the Original appears unchanged in the output.

Key facts come from the Original (R2.4). The output lines go through the same
extractor, and the two sides are compared by (type, normalised value) sets, so
"1 March 2026" and "1/3/2026" match while a changed digit does not (R2.3, R2.6).

The lines are joined with line breaks and extracted as one text, with one
"sentence" per line. Facts never run across a line break, except an address,
which may keep its first line and postcode on separate lines as it can in the
Original. Each output fact is mapped back to the lines it covers.

Reported line IDs (design "Checkers"):
- a changed fact: the lines holding an output value of the same type that
  matches nothing in the Original, preferring lines from the fact's source
  sentence;
- a missing fact: the lines whose source sentence holds that fact. If there
  are none, no line is reported and the pipeline asks for a new line.

This module never logs, and `details` hold fact IDs and types, never values (R7.4).
"""

from dataclasses import dataclass

from checks.key_facts import extract_key_facts
from checks.models import CheckResult, KeyFact, KeyFactType, Line, Sentence

_LINE_BREAK = "\n"


@dataclass(frozen=True)
class _OutputFact:
    type: KeyFactType
    normalised: str
    line_ids: tuple[str, ...]


def _key(fact: KeyFact | _OutputFact) -> tuple[str, str]:
    return fact.type, fact.normalised


def _output_facts(lines: list[Line]) -> list[_OutputFact]:
    """Key facts in the output, each with the IDs of the lines it covers."""
    if not lines:
        return []
    sentences: list[Sentence] = []
    offset = 0
    for line in lines:
        sentences.append(
            Sentence(id=line.id, text=line.text, start=offset, end=offset + len(line.text))
        )
        offset += len(line.text) + len(_LINE_BREAK)
    text = _LINE_BREAK.join(line.text for line in lines)

    out: list[_OutputFact] = []
    for fact in extract_key_facts(text, sentences):
        covered = tuple(s.id for s in sentences if s.start < fact.end and fact.start < s.end)
        out.append(_OutputFact(fact.type, fact.normalised, covered or (fact.sentence_id,)))
    return out


def check_p1(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    """Fail if any key fact from the Original is missing or changed in `lines`.

    `original` is unused: `key_facts` were already extracted from it. It is
    kept so every checker has the same signature.
    """
    del original
    output = _output_facts(lines)
    output_keys = {_key(o) for o in output}
    original_keys = {_key(f) for f in key_facts}
    unmatched = [o for o in output if _key(o) not in original_keys]
    source = {line.id: line.source_sentence_id for line in lines}

    failed_fact_ids: list[str] = []
    failing_lines: set[str] = set()
    details: list[str] = []
    for fact in key_facts:
        if _key(fact) in output_keys:
            continue
        failed_fact_ids.append(fact.id)
        same_type = [o for o in unmatched if o.type == fact.type]
        near = [o for o in same_type if any(source.get(i) == fact.sentence_id for i in o.line_ids)]
        changed = near or same_type
        if changed:
            ids = {i for o in changed for i in o.line_ids}
            details.append(f"{fact.id} ({fact.type}) has a different value in the output")
        else:
            ids = {line.id for line in lines if line.source_sentence_id == fact.sentence_id}
            details.append(f"{fact.id} ({fact.type}) is missing from the output")
        failing_lines |= ids

    order = {line.id: i for i, line in enumerate(lines)}
    return CheckResult(
        rule="P1",
        passed=not failed_fact_ids,
        line_ids=sorted(failing_lines, key=order.__getitem__),
        failed_fact_ids=failed_fact_ids,
        details=details,
    )
