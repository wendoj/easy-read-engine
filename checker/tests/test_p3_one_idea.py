from hypothesis import given, settings
from hypothesis import strategies as st
from strategies import text_lines

from checks.models import Line
from checks.p3_one_idea import check_p3

# All text here is invented. No real letters or personal data.

_SUBJECTS = ["The council", "Your doctor", "The office", "You", "The team", "Your landlord"]
_MODAL_VERBS = ["will send", "can check", "must pay", "will close", "will fix", "can change"]
_OBJECTS = ["your bill", "the form", "your account", "the letter", "your claim", "the payment"]
# Present-tense clauses with their own subject, for "if" and "because" clauses.
_SUB_SUBJECTS = ["you", "the council", "your landlord"]
_SUB_VERBS = {"you": ["pay", "change", "send"], "the council": ["gets", "checks", "sends"],
              "your landlord": ["gets", "checks", "sends"]}  # fmt: skip


@st.composite
def _clause(draw: st.DrawFn) -> str:
    return " ".join(
        draw(st.sampled_from(xs)) for xs in (_SUBJECTS, _MODAL_VERBS, _OBJECTS)
    )


@st.composite
def _sub_clause(draw: st.DrawFn) -> str:
    subject = draw(st.sampled_from(_SUB_SUBJECTS))
    verb = draw(st.sampled_from(_SUB_VERBS[subject]))
    return f"{subject} {verb} {draw(st.sampled_from(_OBJECTS))}"


def _lower_first(text: str) -> str:
    return text[0].lower() + text[1:]


@st.composite
def _one_idea(draw: st.DrawFn) -> str:
    return draw(_clause()) + "."


@st.composite
def _two_ideas(draw: st.DrawFn) -> str:
    """2 main clauses in 1 sentence, joined in one of the ways P3 must catch."""
    first = draw(_clause())
    kind = draw(st.sampled_from(["and", "but", "if", "because"]))
    if kind in ("and", "but"):
        return f"{first} {kind} {_lower_first(draw(_clause()))}."
    if kind == "if":
        return f"If {draw(_sub_clause())}, {_lower_first(first)}."
    return f"{first} because {draw(_sub_clause())}."


@settings(max_examples=50, deadline=None)
@given(st.lists(_one_idea(), min_size=1, max_size=5))
def test_sentences_with_one_main_clause_pass(texts: list[str]) -> None:
    """**Validates: Requirements 3.1; P3**"""
    result = check_p3("", [], text_lines(texts))
    assert result.rule == "P3"
    assert result.passed, result.details
    assert result.line_ids == []


@settings(max_examples=50, deadline=None)
@given(st.lists(st.tuples(_one_idea(), _two_ideas(), st.booleans()), min_size=1, max_size=4), st.data())
def test_sentences_with_two_main_clauses_fail(
    rows: list[tuple[str, str, bool]], data: st.DataObject
) -> None:
    """**Validates: Requirements 3.1; P3**"""
    flags = [f for _, _, f in rows]
    flags[data.draw(st.integers(min_value=0, max_value=len(rows) - 1))] = True
    lines = text_lines([two if f else one for (one, two, _), f in zip(rows, flags)])
    result = check_p3("", [], lines)
    assert not result.passed
    assert result.line_ids == [line.id for line, f in zip(lines, flags) if f]


def test_two_clauses_joined_by_and_fail() -> None:
    """Checker-must-fail case (the "not like this" example in the Easy Read rules).

    **Validates: Requirements 3.1; P3**
    """
    text = "We have received your form and we will respond by 14 March 2026."
    result = check_p3("", [], text_lines([text]))
    assert not result.passed
    assert result.line_ids == ["l1"]
    assert result.details == ["l1 has a sentence with 2 main clauses (limit 1)"]


def test_if_clause_fails() -> None:
    """Checker-must-fail case. **Validates: Requirements 3.1; P3**"""
    assert not check_p3("", [], text_lines(["If you cannot pay, phone the council."])).passed


def test_two_verbs_sharing_a_subject_fail() -> None:
    """Checker-must-fail case. **Validates: Requirements 3.1; P3**"""
    assert not check_p3("", [], text_lines(["You must pay £45 and send the form."])).passed


def test_split_sentences_pass() -> None:
    lines = text_lines(["The council got your form.", "The council will reply by 14 March 2026."])
    assert check_p3("", [], lines).passed


def test_two_short_sentences_in_one_line_pass() -> None:
    assert check_p3("", [], text_lines(["The council got your form. It will reply soon."])).passed


def test_to_clause_without_its_own_subject_passes() -> None:
    text = "Your rent is the money you pay to live in your home."
    assert check_p3("", [], text_lines([text])).passed


def test_need_to_passes() -> None:
    assert check_p3("", [], text_lines(["You need to pay £45."])).passed


def test_letter_says_you_must_pay_passes() -> None:
    """Allowed wording from the Easy Read rules. **Validates: Requirements 3.1; P3**"""
    lines = text_lines([
        "The letter says you must pay £45 by 1 April 2026.",
        "The council says you can ask for a review.",
        "It says you must send the form.",
        "The letter tells you that you must pay.",
    ])  # fmt: skip
    result = check_p3("", [], lines)
    assert result.passed, result.details


def test_reporting_verb_with_a_second_idea_still_fails() -> None:
    """Checker-must-fail cases. **Validates: Requirements 3.1; P3**"""
    lines = text_lines([
        "The letter says you must pay because you missed a payment.",
        "The letter says you must pay £45 and you must send the form.",
        "We have received your form and we will respond by 14 March 2026.",
        "You must pay because you missed a payment.",
    ])  # fmt: skip
    assert check_p3("", [], lines).line_ids == ["l1", "l2", "l3", "l4"]


def test_active_request_with_a_to_verb_passes() -> None:
    """The active rewrite P4 asks for must not fail P3."""
    lines = text_lines(["The council expects you to sign the form.", "The council asks you to send the form."])
    result = check_p3("", [], lines)
    assert result.passed, result.details


def test_reported_clause_after_a_pronoun_subject_still_counts() -> None:
    # Only the letter, a named sender or "it" can report: "you think" is a second idea.
    assert not check_p3("", [], text_lines(["You think you must pay £45."])).passed


def test_no_lines_pass() -> None:
    assert check_p3("", [], []).passed


def _p3_passes(text: str) -> bool:
    return check_p3("", [], [Line(id="L1", text=text, source_sentence_id="s1", symbol_id=None)]).passed


def test_clauses_that_finish_the_main_idea_pass() -> None:
    """Regression: one-idea lines from the recorded sample letters failed P3."""
    for text in [
        "It looks like you missed a council tax payment.",
        "Think you’ll miss more payments?",
        "Let us know.",
        "Rule 6 status lets you present evidence formally.",
        "The call will discuss how evidence will be heard.",
        "Go online to see if you are entitled to Council Tax support.",
        "It is essential that you contact the Planning Inspectorate.",
        "You must pay what you owe.",
    ]:
        assert _p3_passes(text), text


def test_if_so_and_because_clauses_still_fail() -> None:
    for text in [
        "If you cannot pay, you must tell us.",
        "You need to act now so you don’t have to pay.",
        "We got your form and we will reply.",
        "Pay £45 because your bill is wrong.",
    ]:
        assert not _p3_passes(text), text


def test_if_question_after_check_or_find_out_passes() -> None:
    """Regression: the parse tags these "if" questions as `advcl`, so they failed P3."""
    for text in [
        "Check if you’re due benefits.",
        "Find out if you can get help.",
        "Check if you can pay later.",
    ]:
        assert _p3_passes(text), text


def test_if_condition_after_check_still_fails() -> None:
    for text in [
        "Check your bill if you moved.",
        "If you moved, check your bill.",
        "Tell the council if you move home.",
    ]:
        assert not _p3_passes(text), text


def test_if_condition_tagged_ccomp_still_fails() -> None:
    """Regression: the parse tags "move" as `ccomp`, which used to count as a question."""
    for text in ["Tell us if you move house."]:
        assert not _p3_passes(text), text


def test_if_and_whether_questions_tagged_ccomp_still_pass() -> None:
    for text in [
        "Go online to see if you are entitled to Council Tax support.",
        "Ask whether you can pay later.",
    ]:
        assert _p3_passes(text), text


def test_if_condition_after_know_or_a_negated_find_out_fails() -> None:
    """Regression: both read as questions, but they are conditions."""
    for text in ["Let us know if you move.", "Find out if you cannot pay."]:
        assert not _p3_passes(text), text


def test_whether_after_know_and_plain_let_us_know_still_pass() -> None:
    for text in ["Let us know whether you can pay.", "Let us know.", "Find out if you can get help."]:
        assert _p3_passes(text), text
