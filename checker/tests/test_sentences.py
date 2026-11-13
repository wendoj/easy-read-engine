from hypothesis import given, settings
from hypothesis import strategies as st

from checks.sentences import get_nlp, split_sentences

# Letter-like text: words, numbers, punctuation and line breaks, so the
# property exercises real sentence boundaries as well as arbitrary strings.
_word = st.sampled_from(
    ["The", "council", "will", "pay", "you", "£45", "by", "14", "March", "2026",
     "Ref:", "AB/1234", "Dr.", "Smith", "e.g.", "0300", "123", "4567", "PIP", "rent"]
)
_sep = st.sampled_from([" ", " ", " ", ". ", "? ", "! ", ".\n", "\n\n", ", ", "\t", "  "])
_letter_like = st.lists(st.tuples(_word, _sep), max_size=40).map(
    lambda parts: "".join(w + s for w, s in parts)
)
_any_text = st.one_of(st.text(max_size=300), _letter_like)


@settings(max_examples=200, deadline=None)
@given(_any_text)
def test_sentence_spans_are_ordered_disjoint_and_match_text(text: str) -> None:
    """**Validates: Requirements 2.2, 5.2**"""
    sentences = split_sentences(text)
    prev_end = 0
    for s in sentences:
        assert prev_end <= s.start < s.end <= len(text)
        assert text[s.start : s.end] == s.text
        prev_end = s.end


def test_letter_splits_into_sentences_with_offsets() -> None:
    text = "Dear Ms Patel,\n\nWe have received your form. You must pay £45 by 1 April 2026."
    sentences = split_sentences(text)
    texts = [s.text for s in sentences]
    assert "We have received your form." in texts
    assert "You must pay £45 by 1 April 2026." in texts
    assert [s.id for s in sentences] == [f"s{i}" for i in range(1, len(sentences) + 1)]
    for s in sentences:
        assert text[s.start : s.end] == s.text


def test_phone_number_stays_inside_one_sentence() -> None:
    """Regression: spaCy split "0300 020 0040." into "0300 020" and "0040."."""
    text = (
        "The council made this decision on 1 January 2020. "
        "Please call the council on 0300 020 0040. "
        "You must pay £1 by 1 January 2020."
    )
    assert [s.text for s in split_sentences(text)] == [
        "The council made this decision on 1 January 2020.",
        "Please call the council on 0300 020 0040.",
        "You must pay £1 by 1 January 2020.",
    ]


def test_full_stop_after_a_number_still_ends_the_sentence() -> None:
    text = "You must pay by 2026. 0300 123 4567 is the phone number."
    assert [s.text for s in split_sentences(text)] == [
        "You must pay by 2026.",
        "0300 123 4567 is the phone number.",
    ]


def test_empty_and_whitespace_text_gives_no_sentences() -> None:
    assert split_sentences("") == []
    assert split_sentences("  \n\n\t ") == []


def test_spacy_model_is_loaded_once() -> None:
    assert get_nlp() is get_nlp()


def test_layout_lines_are_separate_sentences() -> None:
    """Regression: spaCy joined PDF labels and table cells into one sentence,
    so key-fact actions spanned cells and P1 blocked every council tax sample."""
    text = (
        "Date of Issue:\nProperty Band\nContact us:  example.gov.uk/contact\n"
        "Or phone: 01842 756577\nMore than 90% of residents pay on time."
    )
    assert [s.text for s in split_sentences(text)] == [
        "Date of Issue:",
        "Property Band",
        "Contact us:  example.gov.uk/contact",
        "Or phone: 01842 756577",
        "More than 90% of residents pay on time.",
    ]


def test_wrapped_prose_stays_one_sentence() -> None:
    text = (
        "If you have paid your Council Tax, and there is nothing left to pay for the year, please ignore this\n"
        "reminder. You may also want to seek advice from organisations like Citizens Advice or the\n"
        "Money Advice Service. Moving home and people moving into or out of your home are likely to affect your Council\n"
        "Tax bill."
    )
    assert [s.text for s in split_sentences(text)] == [
        "If you have paid your Council Tax, and there is nothing left to pay for the year, please ignore this\nreminder.",
        "You may also want to seek advice from organisations like Citizens Advice or the\nMoney Advice Service.",
        "Moving home and people moving into or out of your home are likely to affect your Council\nTax bill.",
    ]


def test_bullets_headings_and_web_addresses_start_new_sentences() -> None:
    text = (
        "Missed council tax payment\nWe can help.\n"
        "Check your account\n• Tell us about any changes\n• Claim Council Tax Support\n"
        "Pay online at www.example.gov.uk/pay\nCredit or debit card"
    )
    assert [s.text for s in split_sentences(text)] == [
        "Missed council tax payment",
        "We can help.",
        "Check your account",
        "• Tell us about any changes",
        "• Claim Council Tax Support",
        "Pay online at www.example.gov.uk/pay",
        "Credit or debit card",
    ]


def test_wrapped_line_before_a_capital_or_digit_stays_one_sentence() -> None:
    """Regression: a capital or digit after a line break ended the sentence,
    which split actions from their objects and dates and weakened P1."""
    for text in [
        "If you have not already paid, please contact\nCitizens Advice for free help.",
        "If you have not already paid, you must pay the full amount shown on this notice before\n"
        "1 April 2026 at the latest.",
        "If you cannot pay the full amount shown on this notice, please contact\n"
        "Manchester City Council on 0161 234 5000.",
    ]:
        assert [s.text for s in split_sentences(text)] == [text]


def test_short_layout_lines_and_web_addresses_still_split() -> None:
    text = (
        "Pay online at www.example.gov.uk/pay\nCredit or debit card\n"
        "Your account number\n12345678\nPay by\n1 April 2026"
    )
    assert [s.text for s in split_sentences(text)] == [
        "Pay online at www.example.gov.uk/pay",
        "Credit or debit card",
        "Your account number",
        "12345678",
        "Pay by\n1 April 2026",
    ]


def test_short_label_and_value_lines_split_when_every_line_is_short() -> None:
    """Regression: lines were measured only against the widest line, so in a
    paragraph of short lines none of them broke."""
    for text, expected in [
        ("Amount due now £120.00\nPay by 1 April 2026", ["Amount due now £120.00", "Pay by 1 April 2026"]),
        (
            "Please pay the balance now\nNext instalment 1 May 2026",
            ["Please pay the balance now", "Next instalment 1 May 2026"],
        ),
        (
            "TOWN AND COUNTRY PLANNING ACT 1990\nAPPEAL UNDER SECTION 78",
            ["TOWN AND COUNTRY PLANNING ACT 1990", "APPEAL UNDER SECTION 78"],
        ),
    ]:
        assert [s.text for s in split_sentences(text)] == expected


def test_label_and_value_lines_with_tabs_split() -> None:
    """A tab separates a label from its value, so a line with a tab is a form
    field, not wrapped prose, even when it is long."""
    text = "Description of development:\t[Insert here]\nApplication reference:\t[Insert here]"
    texts = [s.text for s in split_sentences(text)]
    assert not any("[Insert here]\nApplication" in t for t in texts)


def test_short_address_line_ending_on_a_name_runs_on() -> None:
    """A short line close to the widest that ends on a capitalised word runs
    on (a name or address over 2 lines), as before the wrapped-prose rule."""
    text = "The Planning Inspectorate\nc/o QUADIENT\n69 Buckingham Avenue\nSlough\nSL1 4PN"
    assert "69 Buckingham Avenue\nSlough" in [s.text for s in split_sentences(text)]


def test_long_wrapped_prose_still_runs_on_in_a_short_paragraph() -> None:
    """Prose lines of 40 or more characters stay 1 sentence with no longer line beside them."""
    text = "If you have not already paid, please contact\nCitizens Advice for free help."
    assert [s.text for s in split_sentences(text)] == [text]
