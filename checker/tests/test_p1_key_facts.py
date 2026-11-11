from hypothesis import assume, given, settings
from hypothesis import strategies as st
from strategies import FACT_VALUES

from checks.key_facts import extract_key_facts
from checks.models import KeyFact, Line, Sentence
from checks.p1_key_facts import check_p1
from checks.sentences import split_sentences

# All text here is invented. No real letters or personal data.

# --- generators --------------------------------------------------------------

_SENTENCES = [
    ("You must pay {money} by {date}.", ("money", "date")),
    ("Your reference number is {reference}.", ("reference",)),
    ("Please call the council on {phone}.", ("phone",)),
    ("The council made this decision on {date}.", ("date",)),
    ("Your bill for this year is {money}.", ("money",)),
    ("Your appointment is at {time} on {date}.", ("time", "date")),
    ("Please send the form back within 14 days.", ()),
    ("The council looked at your claim again.", ()),
]
_SLOTS = FACT_VALUES


@st.composite
def _letters(draw: st.DrawFn) -> str:
    """A short invented letter of 2 to 6 sentences with random key facts."""
    templates = draw(st.lists(st.sampled_from(_SENTENCES), min_size=2, max_size=6))
    parts = []
    for template, slots in templates:
        parts.append(template.format(**{slot: draw(_SLOTS[slot]) for slot in slots}))
    return " ".join(parts)


def _analyse(original: str) -> tuple[list[Sentence], list[KeyFact]]:
    sentences = split_sentences(original)
    return sentences, extract_key_facts(original, sentences)


def _faithful_lines(
    sentences: list[Sentence], draw: st.DrawFn
) -> list[Line]:
    """Output lines that keep every sentence's facts unchanged, in any order,
    with extra lines that hold no facts."""
    lines = [
        Line(id=f"l{i}", text=s.text, source_sentence_id=s.id, symbol_id=None)
        for i, s in enumerate(sentences, start=1)
    ]
    lines = draw(st.permutations(lines))
    fillers = draw(st.lists(st.sampled_from(sentences), max_size=3))
    for j, s in enumerate(fillers, start=1):
        lines.insert(
            draw(st.integers(min_value=0, max_value=len(lines))),
            Line(id=f"x{j}", text="This part of the letter is about your home.",
                 source_sentence_id=s.id, symbol_id=None),  # fmt: skip
        )
    return lines


# --- properties --------------------------------------------------------------


@settings(max_examples=40, deadline=None)
@given(_letters(), st.data())
def test_output_with_every_fact_unchanged_passes(original: str, data: st.DataObject) -> None:
    """**Validates: Requirements 2.3, 2.4, 2.6; P1**"""
    sentences, facts = _analyse(original)
    lines = _faithful_lines(sentences, data.draw)
    result = check_p1(original, facts, lines)
    assert result.rule == "P1"
    assert result.passed, result.details
    assert result.failed_fact_ids == []
    assert result.line_ids == []


@settings(max_examples=40, deadline=None)
@given(_letters(), st.data())
def test_changing_one_digit_of_a_date_or_amount_fails(original: str, data: st.DataObject) -> None:
    """Mutation test. **Validates: Requirements 2.3, 2.5; P1**"""
    sentences, facts = _analyse(original)
    targets = [f for f in facts if f.type in ("date", "money")]
    assume(targets)
    # P1 compares sets, so a value that appears twice in the Original still
    # appears after one copy changes. Use letters where each value is unique.
    keys = [(f.type, f.normalised) for f in targets]
    assume(len(keys) == len(set(keys)))

    lines = [
        Line(id=f"l{i}", text=s.text, source_sentence_id=s.id, symbol_id=None)
        for i, s in enumerate(sentences, start=1)
    ]
    assert check_p1(original, facts, lines).passed

    fact = data.draw(st.sampled_from(targets))
    index = next(i for i, s in enumerate(sentences) if s.id == fact.sentence_id)
    sentence = sentences[index]
    digit_positions = [i for i, c in enumerate(fact.value) if c.isdigit()]
    pos = data.draw(st.sampled_from(digit_positions))
    old = fact.value[pos]
    new = data.draw(st.sampled_from([d for d in "0123456789" if d != old]))
    at = fact.start - sentence.start + pos
    mutated = sentence.text[:at] + new + sentence.text[at + 1 :]
    lines[index] = lines[index].model_copy(update={"text": mutated})

    result = check_p1(original, facts, lines)
    assert not result.passed
    assert fact.id in result.failed_fact_ids
    assert lines[index].id in result.line_ids


# --- examples ----------------------------------------------------------------

_ORIGINAL = "The council wrote to you on 2 March 2026. You owe £45 for your council tax."


def _line(id: str, text: str, source: str) -> Line:
    return Line(id=id, text=text, source_sentence_id=source, symbol_id=None)


def test_missing_fact_fails_and_maps_to_lines_from_its_source_sentence() -> None:
    """**Validates: Requirements 2.3, 2.5; P1**"""
    sentences, facts = _analyse(_ORIGINAL)
    money = next(f for f in facts if f.type == "money")
    assert money.sentence_id == sentences[1].id
    lines = [
        _line("l1", "The council wrote to you on 2 March 2026.", sentences[0].id),
        _line("l2", "You owe money for your council tax.", sentences[1].id),
        _line("l3", "Council tax is money you pay for local services.", sentences[1].id),
    ]
    result = check_p1(_ORIGINAL, facts, lines)
    assert not result.passed
    assert result.failed_fact_ids == [money.id]
    assert result.line_ids == ["l2", "l3"]


def test_missing_fact_with_no_lines_from_its_sentence_reports_no_lines() -> None:
    sentences, facts = _analyse(_ORIGINAL)
    money = next(f for f in facts if f.type == "money")
    lines = [_line("l1", "The council wrote to you on 2 March 2026.", sentences[0].id)]
    result = check_p1(_ORIGINAL, facts, lines)
    assert result.failed_fact_ids == [money.id]
    assert result.line_ids == []


def test_changed_amount_reports_the_line_holding_it() -> None:
    sentences, facts = _analyse(_ORIGINAL)
    money = next(f for f in facts if f.type == "money")
    lines = [
        _line("l1", "The council wrote to you on 2 March 2026.", sentences[0].id),
        _line("l2", "You owe £54 for your council tax.", sentences[1].id),
    ]
    result = check_p1(_ORIGINAL, facts, lines)
    assert result.failed_fact_ids == [money.id]
    assert result.line_ids == ["l2"]
    # Details name the fact, never its value (R7.4).
    assert all("45" not in d and "54" not in d for d in result.details)


def test_same_value_in_another_format_passes() -> None:
    sentences, facts = _analyse(_ORIGINAL)
    lines = [
        _line("l1", "The council wrote to you on 02/03/2026.", sentences[0].id),
        _line("l2", "You owe £45.00 for your council tax.", sentences[1].id),
    ]
    assert check_p1(_ORIGINAL, facts, lines).passed


def test_address_split_across_lines_passes() -> None:
    original = "Your new address is 10 Mill Lane, Leeds LS1 4AB."
    sentences, facts = _analyse(original)
    assert any(f.type == "address" for f in facts)
    lines = [
        _line("l1", "Your new address is 10 Mill Lane,", sentences[0].id),
        _line("l2", "Leeds LS1 4AB.", sentences[0].id),
    ]
    assert check_p1(original, facts, lines).passed


def test_no_key_facts_passes() -> None:
    result = check_p1("Thank you.", [], [_line("l1", "Thank you.", "s1")])
    assert result.passed
    assert result.failed_fact_ids == []
