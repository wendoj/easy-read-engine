from hypothesis import assume, given, settings
from hypothesis import strategies as st
from strategies import FACT_VALUES, MONTHS, asked_actions, day_months, split_payment_actions

from checks.key_facts import extract_key_facts
from checks.models import CheckResult, KeyFact, Line, Sentence
from checks.p1_key_facts import check_p1, line_fact_spans
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


@settings(max_examples=40, deadline=None)
@given(split_payment_actions())
def test_action_split_over_two_lines_from_one_sentence_passes(
    case: tuple[str, str, str],
) -> None:
    """A P3 split keeps P1. **Validates: Requirements 2.3, 2.6; P1, P3**"""
    original, first, second = case
    sentences, facts = _analyse(original)
    assert any(f.type == "action" for f in facts)
    source = sentences[0].id
    lines = [_line("l1", first, source), _line("l2", second, source)]
    result = check_p1(original, facts, lines)
    assert result.passed, result.details


@settings(max_examples=40, deadline=None)
@given(asked_actions())
def test_passive_request_rewritten_as_active_passes(case: tuple[str, str]) -> None:
    """A P4 rewrite keeps P1. **Validates: Requirements 2.3, 2.6; P1, P4**"""
    passive, active = case
    sentences, facts = _analyse(passive)
    assert [f.type for f in facts] == ["action"]
    result = check_p1(passive, facts, [_line("l1", active, sentences[0].id)])
    assert result.passed, result.details


@settings(max_examples=40, deadline=None)
@given(day_months(), st.integers(min_value=2020, max_value=2035), st.data())
def test_year_added_to_a_date_passes_and_a_changed_day_or_month_fails(
    day_month: tuple[int, int], year: int, data: st.DataObject
) -> None:
    """**Validates: Requirements 2.3, 2.5, 2.6; P1**"""
    day, month = day_month
    template = "You must pay the bill by {}."
    original = template.format(f"{day} {MONTHS[month - 1]}")
    sentences, facts = _analyse(original)
    date_fact = next(f for f in facts if f.type == "date")
    source = sentences[0].id

    with_year = template.format(f"{day} {MONTHS[month - 1]} {year}")
    passed = check_p1(original, facts, [_line("l1", with_year, source)])
    assert passed.passed, passed.details

    if data.draw(st.booleans()):
        day = data.draw(st.integers(min_value=1, max_value=28).filter(lambda d: d != day))
    else:
        month = data.draw(st.integers(min_value=1, max_value=12).filter(lambda m: m != month))
    changed = template.format(f"{day} {MONTHS[month - 1]} {year}")
    failed = check_p1(original, facts, [_line("l1", changed, source)])
    assert not failed.passed
    assert date_fact.id in failed.failed_fact_ids


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


# --- rules that must not contradict each other (P1 with P3 and P4) -----------


def _p1(original: str, texts: list[str]) -> tuple[list[KeyFact], CheckResult]:
    sentences, facts = _analyse(original)
    source = sentences[0].id
    lines = [_line(f"l{i}", t, source) for i, t in enumerate(texts, start=1)]
    return facts, check_p1(original, facts, lines)


def test_payment_split_into_two_lines_passes() -> None:
    _, result = _p1("Pay £45 by 1 April 2026.", ["You must pay £45.", "Pay it by 1 April 2026."])
    assert result.passed, result.details


def test_split_action_lines_must_share_the_source_sentence() -> None:
    original = "Pay £45 by 1 April 2026. Your bill is £45."
    sentences, facts = _analyse(original)
    action = next(f for f in facts if f.type == "action")
    lines = [
        _line("l1", "You must pay £45.", sentences[1].id),
        _line("l2", "Your bill is £45.", sentences[1].id),
        _line("l3", "The date is 1 April 2026.", sentences[0].id),
    ]
    result = check_p1(original, facts, lines)
    assert action.id in result.failed_fact_ids


def test_split_action_with_a_changed_date_fails() -> None:
    facts, result = _p1(
        "Pay £45 by 1 April 2026.", ["You must pay £45.", "Pay it by 2 April 2026."]
    )
    assert not result.passed
    action = next(f for f in facts if f.type == "action")
    date = next(f for f in facts if f.type == "date")
    assert {action.id, date.id} <= set(result.failed_fact_ids)


def test_dropped_or_changed_action_verb_fails() -> None:
    facts, dropped = _p1("Send the form back by 14 March 2026.", ["The form is due on 14 March 2026."])
    action = next(f for f in facts if f.type == "action")
    assert action.id in dropped.failed_fact_ids
    _, changed = _p1("Send the form back by 14 March 2026.", ["Sign the form by 14 March 2026."])
    assert action.id in changed.failed_fact_ids
    _, negated = _p1("Send the form back by 14 March 2026.", ["Do not send the form back by 14 March 2026."])
    assert action.id in negated.failed_fact_ids


def test_changed_action_object_fails() -> None:
    facts, result = _p1("Send the form.", ["Send the letter."])
    assert [f.id for f in facts if f.type == "action"] == result.failed_fact_ids


def test_active_request_matches_passive_request() -> None:
    _, result = _p1("You are asked to send the form.", ["The council asks you to send the form."])
    assert result.passed, result.details


def test_letter_says_wording_keeps_the_action() -> None:
    _, result = _p1(
        "You must pay £45 by 1 April 2026.", ["The letter says you must pay £45 by 1 April 2026."]
    )
    assert result.passed, result.details


def test_pronoun_objects_are_ignored_on_both_sides() -> None:
    # The Original's pronoun object asks for nothing more than the verb.
    _, result = _p1("Return it by 14 March 2026.", ["Send the form back by 14 March 2026."])
    assert result.passed, result.details
    # The Original's noun object may be named on another line from its sentence.
    _, result = _p1(
        "Send the form back by 14 March 2026.",
        ["This is about your form.", "Send it back by 14 March 2026."],
    )
    assert result.passed, result.details


def test_new_synonyms_pass() -> None:
    for original, rewrite in [
        ("Make a payment of £45.", "Pay £45."),
        ("Please attend the meeting.", "Please go to the meeting."),
        ("Please respond by 1 March 2026.", "Please reply by 1 March 2026."),
        ("You must make an application for a bus pass.", "You must apply for a bus pass."),
    ]:
        _, result = _p1(original, [rewrite])
        assert result.passed, (original, result.details)


def test_year_added_to_a_date_passes() -> None:
    _, result = _p1("You must pay the bill by 1 March.", ["You must pay the bill by 1 March 2026."])
    assert result.passed, result.details


def test_year_dropped_from_a_date_fails() -> None:
    facts, result = _p1("You must pay the bill by 1 March 2026.", ["You must pay the bill by 1 March."])
    date = next(f for f in facts if f.type == "date")
    assert date.id in result.failed_fact_ids


def test_year_added_date_is_highlighted_as_the_original_fact() -> None:
    sentences, facts = _analyse("You must pay the bill by 1 March.")
    date = next(f for f in facts if f.type == "date")
    line = _line("l1", "You must pay the bill by 1 March 2026.", sentences[0].id)
    spans = [s for s in line_fact_spans(facts, [line]) if s.fact_id == date.id]
    assert [line.text[s.start : s.end] for s in spans] == ["1 March 2026"]


def test_split_action_is_highlighted_on_its_verb_lines() -> None:
    sentences, facts = _analyse("Pay £45 by 1 April 2026.")
    action = next(f for f in facts if f.type == "action")
    lines = [
        _line("l1", "You must pay £45.", sentences[0].id),
        _line("l2", "Pay it by 1 April 2026.", sentences[0].id),
    ]
    spans = line_fact_spans(facts, lines)
    assert {s.line_id for s in spans if s.fact_id == action.id} == {"l1", "l2"}
