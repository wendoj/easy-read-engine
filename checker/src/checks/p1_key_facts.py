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
from checks.models import CheckResult, KeyFact, KeyFactType, Line, LineFactSpan, Sentence

_LINE_BREAK = "\n"


@dataclass(frozen=True)
class _OutputFact:
    type: KeyFactType
    normalised: str
    line_ids: tuple[str, ...]
    # (line ID, start, end) per covered line, offsets into that line's text.
    spans: tuple[tuple[str, int, int], ...]


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
        covering = [s for s in sentences if s.start < fact.end and fact.start < s.end]
        covered = tuple(s.id for s in covering)
        spans = tuple(
            (s.id, max(fact.start, s.start) - s.start, min(fact.end, s.end) - s.start) for s in covering
        )
        out.append(_OutputFact(fact.type, fact.normalised, covered or (fact.sentence_id,), spans))
    return out


def line_fact_spans(key_facts: list[KeyFact], lines: list[Line]) -> list[LineFactSpan]:
    """Where each key fact from the Original appears in the output lines.

    Uses the same extraction and normalisation as P1, so a span is returned
    exactly when P1 counts that output value as the fact. Values that match no
    fact in the Original are left out. A fact that runs over a line break (an
    address) gets one span per line.

    When several facts in the Original share a normalised value, the span names
    the one from the line's source sentence, or else the first in `key_facts`.
    Spans are in line order, then by start offset.
    """
    by_key: dict[tuple[str, str], list[KeyFact]] = {}
    for fact in key_facts:
        by_key.setdefault(_key(fact), []).append(fact)
    source = {line.id: line.source_sentence_id for line in lines}
    order = {line.id: i for i, line in enumerate(lines)}

    out: list[LineFactSpan] = []
    for output in _output_facts(lines):
        candidates = by_key.get(_key(output))
        if not candidates:
            continue
        for line_id, start, end in output.spans:
            if end <= start:
                continue
            near = [f for f in candidates if f.sentence_id == source.get(line_id)]
            fact = (near or candidates)[0]
            out.append(LineFactSpan(line_id=line_id, fact_id=fact.id, start=start, end=end))
    out.sort(key=lambda s: (order[s.line_id], s.start, s.end))
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
