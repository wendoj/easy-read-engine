from hypothesis import given, settings
from hypothesis import strategies as st

from checks.models import KeyFact, Line
from checks.p5_plain_words import check_p5, common_words

# All text here is invented. No real letters or personal data.

# --- generators --------------------------------------------------------------

_SUBJECTS = ["The council", "Your doctor", "The office", "You", "The team", "Your family"]
_VERBS = ["will send", "can check", "must pay", "will change", "can read", "will get"]
_OBJECTS = ["your bill", "the form", "your money", "the letter", "your home", "the payment"]
_ENDINGS = ["", " this week", " by phone", " next month", " at the office", " today"]

# Official words that are not on the common-word list (checked below).
_HARD_WORDS = ["forfeiture", "remittance", "adjudication", "reassessment", "jurisdiction",
               "indemnity", "arrears", "summons"]  # fmt: skip


@st.composite
def _plain(draw: st.DrawFn) -> str:
    """A sentence made only of common words."""
    parts = [draw(st.sampled_from(xs)) for xs in (_SUBJECTS, _VERBS, _OBJECTS)]
    return " ".join(parts) + draw(st.sampled_from(_ENDINGS)) + "."


@st.composite
def _with_hard_word(draw: st.DrawFn, word: str) -> str:
    """A sentence of common words plus 1 hard word."""
    subject, verb = draw(st.sampled_from(_SUBJECTS)), draw(st.sampled_from(_VERBS))
    return f"{subject} {verb} your {word}{draw(st.sampled_from(_ENDINGS))}."


def _definition(word: str) -> str:
    return f"Your {word} means the money you need to pay."


def _lines(texts: list[str]) -> list[Line]:
    return [
        Line(id=f"l{i}", text=t, source_sentence_id="s1", symbol_id=None)
        for i, t in enumerate(texts, start=1)
    ]


def test_generator_words_are_on_the_list_and_hard_words_are_not() -> None:
    words = common_words()
    for phrase in _SUBJECTS + _VERBS + _OBJECTS + _ENDINGS:
        for w in phrase.lower().split():
            assert w in words, w
    for w in _HARD_WORDS:
        assert w not in words, w


# --- properties --------------------------------------------------------------


@settings(max_examples=50, deadline=None)
@given(st.lists(_plain(), min_size=1, max_size=5))
def test_common_words_pass(texts: list[str]) -> None:
    """**Validates: Requirements 3.1; P5**"""
    result = check_p5("", [], _lines(texts))
    assert result.rule == "P5"
    assert result.passed, result.details
    assert result.line_ids == []


@settings(max_examples=50, deadline=None)
@given(
    st.lists(st.tuples(_plain(), st.sampled_from(_HARD_WORDS), st.booleans()), min_size=1, max_size=4),
    st.data(),
)
def test_hard_words_that_are_not_explained_fail(
    rows: list[tuple[str, str, bool]], data: st.DataObject
) -> None:
    """**Validates: Requirements 3.1; P5**"""
    flags = [f for _, _, f in rows]
    flags[data.draw(st.integers(min_value=0, max_value=len(rows) - 1))] = True
    texts = [data.draw(_with_hard_word(w)) if f else p for (p, w, _), f in zip(rows, flags)]
    lines = _lines(texts)
    result = check_p5("", [], lines)
    assert not result.passed
    assert result.line_ids == [line.id for line, f in zip(lines, flags) if f]


@settings(max_examples=50, deadline=None)
@given(
    st.sampled_from(_HARD_WORDS),
    st.integers(min_value=0, max_value=2),
    st.integers(min_value=0, max_value=3),
    st.data(),
)
def test_hard_words_pass_only_after_they_are_defined(
    word: str, before: int, after: int, data: st.DataObject
) -> None:
    """**Validates: Requirements 3.1; P5**"""
    texts = [data.draw(_with_hard_word(word)) for _ in range(before)]
    texts.append(_definition(word))
    texts += [data.draw(_with_hard_word(word)) for _ in range(after)]
    lines = _lines(texts)
    result = check_p5("", [], lines)
    assert result.passed == (before == 0), result.details
    assert result.line_ids == [line.id for line in lines[:before]]


# --- checker-must-fail cases and examples ------------------------------------


def test_official_wording_fails() -> None:
    """Checker-must-fail case from the Easy Read rules. **Validates: Requirements 3.1; P5**"""
    result = check_p5("", [], _lines(["Your rental liability has been reassessed."]))
    assert not result.passed
    assert result.line_ids == ["l1"]
    # "rental" and "reassessed"; "liability" is on the NGSL.
    assert result.details == ["l1 has 2 words that are not common and not explained"]


def test_amount_after_is_does_not_define_a_word() -> None:
    """Checker-must-fail case. **Validates: Requirements 3.1; P5**"""
    assert not check_p5("", [], _lines(["Your arrears are £120."])).passed


def test_definition_on_first_use_passes() -> None:
    lines = _lines(["Your rent is the money you pay to live in your home.", "Your rent is £450."])
    assert check_p5("", [], lines).passed


def test_numbers_web_addresses_and_abbreviations_pass() -> None:
    lines = _lines([
        "Pay £45 by 14 March 2026.",
        "Go to www.example.gov.uk to pay.",
        "Your PIP will start soon.",
    ])  # fmt: skip
    assert check_p5("", [], lines).passed


def test_names_pass() -> None:
    assert check_p5("", [], _lines(["Manchester City Council will send you a bill."])).passed


def test_key_fact_words_pass() -> None:
    fact = KeyFact(id="k1", type="address", value="Grimsdyke Road, Ashwell AB1 2ZZ",
                   normalised="ab12zz|grimsdyke road", start=0, end=31, sentence_id="s1")  # fmt: skip
    line = "Send the form to grimsdyke road."
    assert check_p5("", [fact], _lines([line])).passed


def test_action_key_fact_words_are_still_checked() -> None:
    fact = KeyFact(id="k1", type="action", value="remit the adjudication fee",
                   normalised="remit|adjudication fee", start=0, end=26, sentence_id="s1")  # fmt: skip
    assert not check_p5("", [fact], _lines(["You must remit the adjudication fee."])).passed


def test_no_lines_pass() -> None:
    assert check_p5("", [], []).passed
