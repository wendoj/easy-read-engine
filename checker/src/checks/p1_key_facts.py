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
  Each date and amount stays tied to its own action. Within a group, the
  actions with the same verb phrase are split into units in line order, and a
  new unit starts when an action repeats a value type or object. A unit must
  carry the Original action's own values, and lines that belong to a sibling
  unit are not searched. A line in the group with no action of that phrase
  ("The deadline is 1 May 2026.") belongs to the nearest unit before it when
  no such line with a key fact comes before the first action, or to the
  nearest unit after it when none comes after the last action. If both
  happen, a line between 2 units belongs to neither. So when one sentence
  holds 2 payments, swapping their amounts or dates between the lines fails.

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
# A year on its own. spaCy tags "2018" as a date in some sentences and not in
# others ("the Data Protection Act 2018"), so the output also counts any year
# that no other fact covers.
_YEAR = re.compile(r"(?<![\d.,/:-])(?:19|20)\d{2}(?![\d.,/:-]\d)")


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

    facts = extract_key_facts(text, sentences)
    covered = [(f.start, f.end) for f in facts if f.type != "action"]
    for m in _YEAR.finditer(text):
        if not any(start < m.end() and m.start() < end for start, end in covered):
            facts.append(
                KeyFact(
                    id="year",
                    type="date",
                    value=m.group(),
                    normalised=m.group(),
                    start=m.start(),
                    end=m.end(),
                    sentence_id=next(s.id for s in sentences if s.start <= m.start() < s.end + 1),
                )
            )

    out: list[_OutputFact] = []
    for fact in facts:
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

    def _units(self, phrase: str, group: set[str]) -> list[list[int]]:
        """Split the group's actions with `phrase` into units, in line order.

        A unit is one action, which may be split over lines. A new unit starts
        at an action that repeats a value type or an object the current unit
        already has, so "You must pay £45." and "Pay it by 1 April 2026." form
        one unit, while "Pay £45 by 1 May 2026." and "Pay £20 by 1 April 2026."
        form two. This keeps each date and amount tied to its own action.
        """
        order = {line.id: n for n, line in enumerate(self._lines)}
        members = sorted(
            (
                i
                for i, a in self._actions.items()
                if a.phrase == phrase and group.intersection(self._output[i].line_ids)
            ),
            key=lambda i: min(order[x] for x in self._output[i].line_ids),
        )
        units: list[list[int]] = []
        kinds: set[str] = set()
        has_objects = False
        for i in members:
            action = self._actions[i]
            own = {kind for kind, _ in action.facts}
            if not units or own & kinds or (action.objects and has_objects):
                units.append([])
                kinds, has_objects = set(), False
            units[-1].append(i)
            kinds |= own
            has_objects = has_objects or bool(action.objects)
        return units

    def _unit_lines(self, unit: list[int], units: list[list[int]], group: set[str]) -> set[str]:
        """The lines a unit searches for objects and values.

        These are the unit's own action lines plus some of the group's other
        lines (lines with no action of this phrase). With one unit, the whole
        group is searched. With several, the other lines that hold a key fact
        set the layout:

        - none before the first action: each line describes the action before
          it ("You must pay £45." then "The deadline is 1 April 2026.");
        - none after the last action: each line describes the action after it
          ("The deadline is 1 April 2026." then "You must pay £45.");
        - some before and some after: a line between 2 units could describe
          either, so no unit searches it, and a line before the first or after
          the last action goes to that unit. P1 fails rather than guess.

        A line with no unit on the side the layout points to holds no key fact,
        so it is shared by every unit.
        """
        order = {line.id: n for n, line in enumerate(self._lines)}
        owner: dict[str, int] = {}
        for n, u in enumerate(units):
            for i in u:
                for line_id in self._output[i].line_ids:
                    owner[line_id] = n
        index = units.index(unit)
        lines = {line_id for line_id, n in owner.items() if n == index}
        others = group - owner.keys()
        if len(units) == 1:
            return lines | others
        action_lines = sorted(owner, key=order.__getitem__)
        first, last = order[action_lines[0]], order[action_lines[-1]]
        fact_lines = {
            x for o in self._output if o.type != "action" for x in o.line_ids if x in others
        }
        after = not any(order[x] < first for x in fact_lines)
        before = not any(order[x] > last for x in fact_lines)
        for line_id in others:
            earlier = [owner[x] for x in action_lines if order[x] < order[line_id]]
            later = [owner[x] for x in action_lines if order[x] > order[line_id]]
            if after:
                belongs = earlier[-1] == index if earlier else True
            elif before:
                belongs = later[0] == index if later else True
            elif not earlier:
                belongs = later[0] == index
            elif not later:
                belongs = earlier[-1] == index
            else:
                belongs = earlier[-1] == later[0] == index
            if belongs:
                lines.add(line_id)
        return lines

    def _unit_matches(self, original: _Action, lines: set[str], unit: list[int]) -> bool:
        """Whether a unit, searching `lines`, shows the Original action.

        A value type that an action in the unit carries must match one of the
        unit's own values, so a value from a sibling action can't stand in for
        it. Other values are looked for anywhere in `lines`.
        """
        nouns: set[str] = set()
        for line_id in lines:
            nouns |= self._line_nouns().get(line_id, frozenset())
        if not original.objects <= nouns:
            return False
        own_facts = [f for i in unit for f in self._actions[i].facts]
        free = [o for o in self._output if o.type != "action" and lines.intersection(o.line_ids)]
        for kind, value in original.facts:
            carried = [v for k, v in own_facts if k == kind]
            if carried:
                if not any(_value_matches(kind, value, v) for v in carried):
                    return False
            elif not any(o.type == kind and _value_matches(kind, value, o.normalised) for o in free):
                return False
        return True

    def _action_matches(self, original: _Action) -> list[int]:
        found: list[int] = []
        seen: set[int] = set()
        for i, action in self._actions.items():
            if action.phrase != original.phrase or i in seen:
                continue
            group = self._group(self._output[i].line_ids)
            units = self._units(original.phrase, group)
            for unit in units:
                if i not in unit:
                    continue
                seen.update(unit)
                if self._unit_matches(original, self._unit_lines(unit, units, group), unit):
                    found.extend(unit)
        return sorted(set(found))

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
