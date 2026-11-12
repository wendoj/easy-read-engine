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


def _p5_passes(text: str) -> bool:
    return check_p5("", [], [Line(id="L1", text=text, source_sentence_id="s1", symbol_id=None)]).passed


def test_short_forms_names_and_labels_pass() -> None:
    """Regression: curly-apostrophe short forms ("you’ll"), names spaCy didn't
    tag, "Band A" and "e‑mail" (non-breaking hyphen) failed P5 in the samples."""
    for text in [
        "Think you’ll miss more payments?",
        "You don’t have to pay.",
        "You’re in Property Band A.",
        "Call StepChange or National Debtline for free help.",
        "Send us an e‑mail.",
    ]:
        assert _p5_passes(text), text


def test_hard_words_still_fail() -> None:
    for text in ["The appellant has made an appeal.", "You have arrears."]:
        assert not _p5_passes(text), text


def test_hyphen_compounds_names_and_bill_words_pass() -> None:
    """Regression: "cross‑examine" (U+2011), "StepChange" starting a sentence and
    everyday bill words failed P5 on the recorded samples."""
    for text in [
        "You can cross‑examine the council.",
        "StepChange can help you for free.",
        "PayPoint is in many shops.",
        "This is a reminder.",
        "The deadline is 1 April 2026.",
        "Your payment is overdue.",
        "Take the barcode to the shop.",
        "Go paperless.",
        "Read the booklet.",
    ]:
        assert _p5_passes(text), text


def test_hard_hyphen_compounds_and_capitalised_words_still_fail() -> None:
    for text in ["There is a pre‑inquiry call.", "Arrears are high.", "Instalments are due."]:
        assert not _p5_passes(text), text


def test_title_case_jargon_is_not_a_name() -> None:
    """Regression: every capitalised proper noun after the first word passed
    as a name, so legal terms that letters write in Title Case escaped P5."""
    for text in ["An Enforcement Agent may visit you.", "The council can apply for a Committal Order."]:
        assert not _p5_passes(text), text


def test_names_with_inner_capitals_and_tagged_names_still_pass() -> None:
    for text in ["StepChange can help you for free.", "Call Citizens Advice for free help."]:
        assert _p5_passes(text), text


def test_listed_sender_service_and_place_names_pass() -> None:
    """Regression (review v2): after Title Case words stopped passing as
    names, the sender and the places a reader must see failed P5 on the
    recorded samples, and regenerate was told to swap them."""
    for text in [
        "The Planning Inspectorate will decide your appeal.",
        "The Inspector will look at your comments.",
        "You can get it from GOV.UK.",
        "Citizen’s Advice Manchester can help you.",
        "Call National Debtline for free help.",
    ]:
        assert _p5_passes(text), text


def test_listed_names_pass_only_as_written() -> None:
    """Still fails: a listed name in lower case is checked as a word."""
    for text in ["The inspectorate will decide.", "Ring the debtline."]:
        assert not _p5_passes(text), text


def _address_fact(original: str, value: str) -> KeyFact:
    start = original.index(value)
    return KeyFact(
        id="f1", type="address", value=value, normalised="CB74EE",
        start=start, end=start + len(value), sentence_id="s1",
    )  # fmt: skip


def test_address_lines_before_a_key_fact_postcode_pass() -> None:
    """Regression (review v2): "The Grange" in a payment address failed P5.
    P1 checks only the postcode, so regenerate could change the address."""
    line = "Send cheques to the council, The Grange, Nutholt Lane, Ely, Cambs, CB7 4EE."
    original = "The Grange, Nutholt Lane, Ely, Cambs, CB7 4EE."
    fact = _address_fact(original, "CB7 4EE")
    assert check_p5(original, [fact], _lines([line])).passed
    # The letter prints each address part on its own line.
    original = "Pay by cheque to:\nThe Grange\nNutholt Lane\nEly\nCambs\nCB7 4EE"
    assert check_p5(original, [_address_fact(original, "CB7 4EE")], _lines([line])).passed


def test_address_words_the_original_lacks_still_fail() -> None:
    """Still fails (review v1, 12 November 2026): the address run passed every
    capitalised word before the postcode, even words the letter never had."""
    original = "Send cheques to The Grange, Ely, CB7 4EE."
    fact = _address_fact(original, "CB7 4EE")
    assert not check_p5(original, [fact], _lines(["Send cheques to the Enforcement Agent, CB7 4EE."])).passed
    # A word from another sentence of the letter is not part of the address.
    original = "An Enforcement Agent may visit. Send cheques to The Grange, Ely, CB7 4EE."
    fact = _address_fact(original, "CB7 4EE")
    assert not check_p5(original, [fact], _lines(["Send cheques to the Enforcement Agent, CB7 4EE."])).passed


def test_address_words_need_a_key_fact_postcode() -> None:
    """Still fails: with no address key fact, or a postcode that isn't one, the
    same words are checked, and the walk back stops at the first other word."""
    line = "Send cheques to the council, The Grange, Nutholt Lane, Ely, Cambs, CB7 4EE."
    assert not check_p5("", [], _lines([line])).passed
    other = _address_fact("Write to SW1A 2AA.", "SW1A 2AA")
    assert not check_p5("", [other], _lines([line])).passed
    fact = _address_fact("The Grange, Ely, CB7 4EE.", "CB7 4EE")
    for text in ["An Enforcement Agent may visit The Grange, Ely, CB7 4EE.", "The Grange, Ely, CB7 4EE has arrears."]:
        assert not check_p5("", [fact], _lines([text])).passed, text


def test_placeholder_copied_from_the_original_passes() -> None:
    """Regression (Bedrock samples, November 2026): a template letter prints
    "£XXX.XX" for the amount, and the line that copied it failed P5."""
    original = "You now owe £XXX.XX. Quote reference XXXXXXXXX."
    assert check_p5(original, [], _lines(["You now owe £XXX.XX.", "Your reference is XXXXXXXXX."])).passed


def test_placeholder_needs_to_be_in_the_original() -> None:
    """Still fails: a run of X's the Original doesn't have, or fewer than 3 X's,
    and a hard word next to a copied placeholder."""
    original = "You now owe £XXX.XX."
    for text in ["You now owe £XXXX.XX.", "You owe xxx money."]:
        assert not check_p5(original, [], _lines([text])).passed, text
    assert not check_p5("XX", [], _lines(["You owe XX in arrears."])).passed
    assert not check_p5(original, [], _lines(["You owe £XXX.XX in arrears."])).passed


def test_title_case_jargon_still_fails_next_to_listed_names() -> None:
    for text in [
        "The Planning Inspectorate can apply for a Committal Order.",
        "The Inspector can make a Committal Order.",
    ]:
        assert not _p5_passes(text), text
