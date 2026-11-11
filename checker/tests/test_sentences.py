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
    """Regression: spaCy split "0300 020 0040." into "0300 020" and "0040."
    (found by the P1 property, task 5, during task 23)."""
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
