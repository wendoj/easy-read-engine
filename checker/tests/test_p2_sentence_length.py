from hypothesis import given, settings
from hypothesis import strategies as st

from checks.config import MAX_SENTENCE_WORDS
from checks.models import Line
from checks.p2_sentence_length import check_p2, count_words

# All text here is invented. No real letters or personal data.

# --- generators --------------------------------------------------------------

# Sentences of 1 to 4 words, with their word counts.
_SHORT = {
    1: ["Thanks."],
    2: ["Thank you.", "Pay £45."],
    3: ["You must pay.", "Ring 0300 1234567."],
    4: ["You must pay rent.", "Phone 0300 123 4567."],
}
_ADJECTIVES = ["new", "large", "yearly", "unpaid", "water", "final"]
# Phrases with their word counts. Some hold key-fact values, so the property
# also pins down how those are counted.
_PHRASES = [
    ("for your rent", 3),
    ("for £1,234.56", 2),
    ("by card", 2),
    ("at the office", 3),
    ("on 14 March 2026", 4),
    ("before 10:30am", 2),
    ("with reference AB123456", 3),
    ("by 02/03/2026", 2),
    ("in the town", 3),
    ("each month", 2),
]


@st.composite
def _sentences(draw: st.DrawFn, words: int) -> str:
    """One sentence of exactly `words` words."""
    if words in _SHORT:
        return draw(st.sampled_from(_SHORT[words]))
    budget = words - 5  # "You must pay the ... bill" has 5 words
    phrases: list[str] = []
    # Mostly phrases; whatever is left over becomes adjectives before "bill".
    while budget >= 2 and draw(st.integers(min_value=0, max_value=4)) > 0:
        text, n = draw(st.sampled_from([p for p in _PHRASES if p[1] <= budget]))
        phrases.append(text)
        budget -= n
    adjectives = draw(st.lists(st.sampled_from(_ADJECTIVES), min_size=budget, max_size=budget))
    return " ".join(["You must pay the", *adjectives, "bill", *phrases]) + "."


def _line(id: str, text: str) -> Line:
    return Line(id=id, text=text, source_sentence_id="s1", symbol_id=None)


_short_lengths = st.integers(min_value=1, max_value=MAX_SENTENCE_WORDS)
_long_lengths = st.integers(min_value=MAX_SENTENCE_WORDS + 1, max_value=40)


# --- properties --------------------------------------------------------------


@settings(max_examples=60, deadline=None)
@given(st.lists(_short_lengths, min_size=1, max_size=4), _long_lengths, st.data())
def test_any_sentence_of_16_or_more_words_fails(
    short: list[int], long: int, data: st.DataObject
) -> None:
    """**Validates: Requirements 3.1; P2**"""
    texts = [data.draw(_sentences(n)) for n in short]
    long_text = data.draw(_sentences(long))
    assert count_words(long_text) == long
    at = data.draw(st.integers(min_value=0, max_value=len(texts)))
    texts.insert(at, long_text)
    lines = [_line(f"l{i}", t) for i, t in enumerate(texts, start=1)]

    result = check_p2("", [], lines)
    assert result.rule == "P2"
    assert not result.passed
    assert result.line_ids == [lines[at].id]


@settings(max_examples=60, deadline=None)
@given(st.lists(_short_lengths, min_size=1, max_size=5), st.data())
def test_any_sentence_of_15_or_fewer_words_passes(lengths: list[int], data: st.DataObject) -> None:
    """**Validates: Requirements 3.1; P2**"""
    texts = [data.draw(_sentences(n)) for n in lengths]
    assert [count_words(t) for t in texts] == lengths
    lines = [_line(f"l{i}", t) for i, t in enumerate(texts, start=1)]

    result = check_p2("", [], lines)
    assert result.passed, result.details
    assert result.line_ids == []


# --- checker-must-fail cases and examples ------------------------------------

_SIXTEEN = "Following our review of your account you are now required to pay the full balance today."
_FIFTEEN = "Following our review of your account you are now required to pay the balance today."


def test_16_word_sentence_fails() -> None:
    """Checker-must-fail case from the brief. **Validates: Requirements 3.1; P2**"""
    assert count_words(_SIXTEEN) == 16
    result = check_p2("", [], [_line("l1", _SIXTEEN)])
    assert not result.passed
    assert result.line_ids == ["l1"]
    assert result.details == ["l1 has a sentence of 16 words (limit 15)"]


def test_15_word_sentence_passes() -> None:
    assert count_words(_FIFTEEN) == 15
    assert check_p2("", [], [_line("l1", _FIFTEEN)]).passed


def test_long_second_sentence_in_a_line_fails() -> None:
    result = check_p2("", [], [_line("l1", "You must pay £45. " + _SIXTEEN)])
    assert result.line_ids == ["l1"]


def test_word_count_examples() -> None:
    assert count_words("£45") == 1
    assert count_words("£1,234.56 10:30am 14:30 AB123456 02/03/2026") == 5
    assert count_words("don't self-employed (PIP)") == 3
    assert count_words("14 March 2026") == 3
    assert count_words("0300 123 4567") == 3
    assert count_words("LS1 4AB") == 2
    assert count_words("rent - & / bills") == 2
    assert count_words("") == 0


def test_empty_lines_pass() -> None:
    assert check_p2("", [], []).passed
    assert check_p2("", [], [_line("l1", "")]).passed
