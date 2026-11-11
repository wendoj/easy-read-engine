"""P1: every key fact in the Original appears unchanged in the output.

Key facts come from the Original (R2.4). The output lines go through the same
extractor, and each fact in the Original is looked for among the output facts
of the same type (R2.3, R2.6):

- Dates, times, money, references, phones and addresses match by normalised
  value, so "1 March 2026" and "1/3/2026" match while a changed digit does
  not. One exception: an Original date with no year ("1 March", normalised
  "--03-01") also matches an output date with the same day and month and a
  year added ("1 March 2026"). The reverse is not allowed: if the Original
  has a year, the output must keep it.
- A required action matches when an output action has the same verb phrase
  (after `ACTION_SYNONYMS`, with "not" kept), and that action's group of lines
  holds the rest of it. The group is the line with the verb plus every line
  that shares its source sentence. Every object noun of the Original action
  must appear as a noun in the group, and every date or amount inside the
  Original action must appear in the group with a matching value. So "Pay £45
  by 1 April 2026." may be split into "You must pay £45." and "Pay it by 1
  April 2026." to meet P3. Pronoun objects ("it", "them", "this", "that") are
  ignored on both sides. Dropping the action, negating it or changing its verb
  to a word that is not a listed synonym still fails.

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

import re
from dataclasses import dataclass

from checks.key_facts import extract_key_facts
from checks.models import CheckResult, KeyFact, KeyFactType, Line, LineFactSpan, Sentence
from checks.sentences import get_nlp

_LINE_BREAK = "\n"
_PRONOUNS = frozenset({"it", "them", "this", "that", "these", "those"})
_NOUN_POS = frozenset({"NOUN", "PROPN"})
_DATE_NO_YEAR = re.compile(r"--\d{2}-\d{2}")
_DATE_FULL = re.compile(r"\d{4}-\d{2}-\d{2}")


@dataclass(frozen=True)
class _OutputFact:
    type: KeyFactType
    normalised: str
    line_ids: tuple[str, ...]
    # (line ID, start, end) per covered line, offsets into that line's text.
    spans: tuple[tuple[str, int, int], ...]


@dataclass(frozen=True)
class _Action:
    phrase: str
    objects: frozenset[str]
    # (type, normalised) of each date or amount inside the action.
    facts: tuple[tuple[str, str], ...]


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


def _parse_action(normalised: str) -> _Action:
    """Split an action's normalised value, "phrase|objects|type=value,...", into parts."""
    phrase, objects, facts = (normalised.split("|", 2) + ["", ""])[:3]
    return _Action(
        phrase=phrase,
        objects=frozenset(o for o in objects.split(",") if o and o not in _PRONOUNS),
        facts=tuple(
            (kind, value)
            for kind, _, value in (f.partition("=") for f in facts.split(",") if f)
        ),
    )


def _value_matches(kind: str, original: str, output: str) -> bool:
    """Whether an output value shows an Original value of type `kind`.

    Equal normalised values match. An Original date with no year also matches
    an output date with the same day and month and a year added.
    """
    if original == output:
        return True
    return (
        kind == "date"
        and _DATE_NO_YEAR.fullmatch(original) is not None
        and _DATE_FULL.fullmatch(output) is not None
        and output[4:] == original[1:]
    )


class _Matcher:
    """Finds the output facts that show each key fact from the Original."""

    def __init__(self, lines: list[Line], output: list[_OutputFact]) -> None:
        self._lines = lines
        self._output = output
        self._source = {line.id: line.source_sentence_id for line in lines}
        self._nouns: dict[str, frozenset[str]] | None = None
        self._actions = {
            i: _parse_action(o.normalised) for i, o in enumerate(output) if o.type == "action"
        }

    def _line_nouns(self) -> dict[str, frozenset[str]]:
        """Noun lemmas per line, parsed only when an action needs them."""
        if self._nouns is None:
            docs = get_nlp().pipe(line.text for line in self._lines)
            self._nouns = {
                line.id: frozenset(t.lemma_.lower() for t in doc if t.pos_ in _NOUN_POS)
                for line, doc in zip(self._lines, docs)
            }
        return self._nouns

    def _group(self, line_ids: tuple[str, ...]) -> set[str]:
        sources = {self._source.get(i) for i in line_ids}
        return set(line_ids) | {line.id for line in self._lines if line.source_sentence_id in sources}

    def _action_matches(self, original: _Action) -> list[int]:
        found: list[int] = []
        for i, action in self._actions.items():
            if action.phrase != original.phrase:
                continue
            group = self._group(self._output[i].line_ids)
            nouns: set[str] = set()
            for line_id in group:
                nouns |= self._line_nouns().get(line_id, frozenset())
            if not original.objects <= nouns:
                continue
            in_group = [
                o for o in self._output if o.type != "action" and group.intersection(o.line_ids)
            ]
            if all(
                any(o.type == kind and _value_matches(kind, value, o.normalised) for o in in_group)
                for kind, value in original.facts
            ):
                found.append(i)
        return found

    def matches(self, fact: KeyFact) -> list[int]:
        """Indices of the output facts that show `fact`. Empty means missing or changed."""
        if fact.type == "action":
            return self._action_matches(_parse_action(fact.normalised))
        return [
            i
            for i, o in enumerate(self._output)
            if o.type == fact.type and _value_matches(fact.type, fact.normalised, o.normalised)
        ]


def line_fact_spans(key_facts: list[KeyFact], lines: list[Line]) -> list[LineFactSpan]:
    """Where each key fact from the Original appears in the output lines.

    Uses the same extraction and matching as P1, so a span is returned exactly
    when P1 counts that output value as the fact. Values that match no fact in
    the Original are left out. A fact that runs over a line break (an address)
    gets one span per line.

    When several facts in the Original match one output value, the span names
    the one from the line's source sentence, or else the first in `key_facts`.
    Spans are in line order, then by start offset.
    """
    output = _output_facts(lines)
    matcher = _Matcher(lines, output)
    by_output: dict[int, list[KeyFact]] = {}
    for fact in key_facts:
        for i in matcher.matches(fact):
            by_output.setdefault(i, []).append(fact)
    source = {line.id: line.source_sentence_id for line in lines}
    order = {line.id: i for i, line in enumerate(lines)}

    out: list[LineFactSpan] = []
    for i, found in enumerate(output):
        candidates = by_output.get(i)
        if not candidates:
            continue
        for line_id, start, end in found.spans:
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
    matcher = _Matcher(lines, output)
    found = [matcher.matches(fact) for fact in key_facts]
    used = {i for idxs in found for i in idxs}
    unmatched = [o for i, o in enumerate(output) if i not in used]
    source = {line.id: line.source_sentence_id for line in lines}

    failed_fact_ids: list[str] = []
    failing_lines: set[str] = set()
    details: list[str] = []
    for fact, idxs in zip(key_facts, found):
        if idxs:
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
