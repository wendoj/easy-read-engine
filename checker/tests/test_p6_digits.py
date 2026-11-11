from hypothesis import given, settings
from hypothesis import strategies as st

from checks.models import Line
from checks.p6_digits import check_p6

# All text here is invented. No real letters or personal data.

# --- generators --------------------------------------------------------------

_UNITS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
_TEENS = ["ten", "eleven", "twelve", "thirteen", "fifteen", "eighteen", "nineteen"]
_TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

_TEMPLATES = [
    "You have {n} weeks to pay.",
    "The council will send you {n} letters.",
    "You owe £{d} for {n} months.",
    "Your appointment is in {n} days.",
]


@st.composite
def _number_words(draw: st.DrawFn) -> str:
    """A number from 1 to 999 written in words, such as "twenty-one" or "three hundred"."""
    kind = draw(st.sampled_from(["unit", "teen", "tens", "compound", "hundred"]))
    if kind == "unit":
        return draw(st.sampled_from(_UNITS))
    if kind == "teen":
        return draw(st.sampled_from(_TEENS))
    if kind == "tens":
        return draw(st.sampled_from(_TENS))
    if kind == "compound":
        return f"{draw(st.sampled_from(_TENS))}-{draw(st.sampled_from(_UNITS))}"
    return f"{draw(st.sampled_from(_UNITS))} hundred"


@st.composite
def _with_digits(draw: st.DrawFn) -> str:
    n = draw(st.integers(min_value=0, max_value=10_000))
    d = draw(st.integers(min_value=1, max_value=999))
    return draw(st.sampled_from(_TEMPLATES)).format(n=n, d=d)


@st.composite
def _with_words(draw: st.DrawFn) -> str:
    d = draw(st.integers(min_value=1, max_value=999))
    return draw(st.sampled_from(_TEMPLATES)).format(n=draw(_number_words()), d=d)


def _lines(texts: list[str]) -> list[Line]:
    return [
        Line(id=f"l{i}", text=t, source_sentence_id="s1", symbol_id=None)
        for i, t in enumerate(texts, start=1)
    ]


# --- properties --------------------------------------------------------------


@settings(max_examples=50, deadline=None)
@given(st.lists(_with_digits(), min_size=1, max_size=5))
def test_numbers_in_digits_pass(texts: list[str]) -> None:
    """**Validates: Requirements 3.1; P6**"""
    result = check_p6("", [], _lines(texts))
    assert result.rule == "P6"
    assert result.passed, result.details
    assert result.line_ids == []


@settings(max_examples=50, deadline=None)
@given(st.lists(st.tuples(_with_digits(), _with_words(), st.booleans()), min_size=1, max_size=4), st.data())
def test_numbers_in_words_fail(rows: list[tuple[str, str, bool]], data: st.DataObject) -> None:
    """**Validates: Requirements 3.1; P6**"""
    flags = [f for _, _, f in rows]
    flags[data.draw(st.integers(min_value=0, max_value=len(rows) - 1))] = True
    lines = _lines([words if f else digits for (digits, words, _), f in zip(rows, flags)])
    result = check_p6("", [], lines)
    assert not result.passed
    assert result.line_ids == [line.id for line, f in zip(lines, flags) if f]


# --- checker-must-fail cases and examples ------------------------------------


def test_spelled_out_number_fails() -> None:
    """Checker-must-fail case from the Easy Read rules. **Validates: Requirements 3.1; P6**"""
    result = check_p6("", [], _lines(["You have three weeks."]))
    assert not result.passed
    assert result.line_ids == ["l1"]
    assert result.details == ["l1 has 1 numbers written in words"]


def test_compound_number_word_fails() -> None:
    """Checker-must-fail case. **Validates: Requirements 3.1; P6**"""
    assert not check_p6("", [], _lines(["You must pay within twenty-one days."])).passed


def test_digits_pass() -> None:
    lines = _lines(["You have 3 weeks.", "Pay £45 by 14 March 2026.", "Phone 0300 123 4567."])
    assert check_p6("", [], lines).passed


def test_ordinal_words_pass() -> None:
    assert check_p6("", [], _lines(["This is the first letter.", "Wait a second."])).passed


def test_no_lines_pass() -> None:
    assert check_p6("", [], []).passed
