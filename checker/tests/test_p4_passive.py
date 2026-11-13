from hypothesis import given, settings
from hypothesis import strategies as st
from strategies import passive_active_pairs as _pairs
from strategies import text_lines

from checks.p4_passive import check_p4

# All text here is invented. No real letters or personal data.


@settings(max_examples=60, deadline=None)
@given(st.lists(_pairs(), min_size=1, max_size=4), st.data())
def test_passive_sentences_fail_and_their_active_forms_pass(
    pairs: list[tuple[str, str]], data: st.DataObject
) -> None:
    """**Validates: Requirements 3.1; P4**"""
    active = check_p4("", [], text_lines([a for _, a in pairs]))
    assert active.rule == "P4"
    assert active.passed, active.details
    assert active.line_ids == []

    # Exactly the lines made passive fail.
    flags = data.draw(st.lists(st.booleans(), min_size=len(pairs), max_size=len(pairs)))
    flags[data.draw(st.integers(min_value=0, max_value=len(pairs) - 1))] = True
    lines = text_lines([p if f else a for (p, a), f in zip(pairs, flags)])
    mixed = check_p4("", [], lines)
    assert not mixed.passed
    assert mixed.line_ids == [line.id for line, f in zip(lines, flags) if f]


def test_passive_sentence_fails() -> None:
    """Checker-must-fail case from the brief. **Validates: Requirements 3.1; P4**"""
    result = check_p4("", [], text_lines(["A letter will be sent to you."]))
    assert not result.passed
    assert result.line_ids == ["l1"]
    assert result.details == ["l1 uses the passive voice"]


def test_active_form_passes() -> None:
    assert check_p4("", [], text_lines(["The council will send you a letter."])).passed


def test_only_passive_lines_are_reported() -> None:
    lines = text_lines([
        "The council got your form.",
        "Your rental liability has been reassessed.",
        "You need to pay £45.",
    ])  # fmt: skip
    assert check_p4("", [], lines).line_ids == ["l2"]


def test_no_lines_pass() -> None:
    assert check_p4("", [], []).passed


def test_statal_passives_after_you_pass() -> None:
    """**Validates: Requirements 3.1; P4**"""
    lines = text_lines([
        "You are entitled to Housing Benefit.",
        "You are required to pay £45.",
        "You are allowed to bring a friend.",
        "You are expected to come to the meeting.",
        "You are supposed to reply by 1 March 2026.",
    ])  # fmt: skip
    result = check_p4("", [], lines)
    assert result.passed, result.details


def test_statal_participles_still_fail_as_real_passives() -> None:
    """Checker-must-fail cases. **Validates: Requirements 3.1; P4**"""
    lines = text_lines([
        "A letter will be sent to you.",
        "The form was sent.",
        "You are asked to send the form.",
        "Your payment is required.",
        "You are allowed by the council to stay.",
    ])  # fmt: skip
    assert check_p4("", [], lines).line_ids == ["l1", "l2", "l3", "l4", "l5"]
