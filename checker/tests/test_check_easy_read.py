from hypothesis import given, settings
from hypothesis import strategies as st
from strategies import LONG_PASSIVE_SENTENCES, passive_active_pairs, synthetic_letters

from checks import CHECKERS, analyse, check_easy_read, extract_key_facts, find_symbol
from checks.config import MAX_SENTENCE_WORDS
from checks.key_facts import extract_key_facts as extract_with_sentences
from checks.models import Line, Sentence
from checks.p2_sentence_length import count_words
from checks.p4_passive import check_p4
from checks.p8_symbols import symbol_ids
from checks.sentences import split_sentences

# All text here is invented. No real letters or personal data.

RULES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]

_symbol_ids = st.one_of(
    st.none(),
    st.sampled_from(sorted(symbol_ids())),
    st.text(max_size=8),
)


@st.composite
def _lines(draw: st.DrawFn, sentences: list[Sentence]) -> list[Line]:
    """Any output lines, with any source IDs and symbol IDs."""
    texts = st.one_of(
        st.sampled_from([s.text for s in sentences]),
        passive_active_pairs().flatmap(lambda pair: st.sampled_from(pair)),
        st.text(max_size=60),
    )
    sources = st.sampled_from([s.id for s in sentences]) | st.text(min_size=1, max_size=4)
    n = draw(st.integers(min_value=0, max_value=6))
    return [
        Line(id=f"l{i}", text=draw(texts), source_sentence_id=draw(sources), symbol_id=draw(_symbol_ids))
        for i in range(1, n + 1)
    ]


@settings(max_examples=40, deadline=None)
@given(synthetic_letters(), st.data())
def test_returns_one_result_per_rule_in_order(original: str, data: st.DataObject) -> None:
    """**Validates: Requirements 3.1, 6.1**"""
    analysis = analyse(original)
    lines = data.draw(_lines(analysis.sentences))
    results = check_easy_read(original, analysis.key_facts, lines)
    assert [r.rule for r in results] == RULES

_ORIGINAL = (
    "Following a recent review of your council tax account, a payment of £45 will be "
    "collected from your bank account on 1 April 2026."
)


def test_results_match_each_checker() -> None:
    analysis = analyse(_ORIGINAL)
    lines = [
        Line(id="l1", text="The council will take £45 from your bank account.", source_sentence_id="s1",
             symbol_id="2239"),
        Line(id="l2", text="This will happen on 1 April 2026.", source_sentence_id="s1", symbol_id=None),
    ]  # fmt: skip
    results = check_easy_read(_ORIGINAL, analysis.key_facts, lines)
    assert results == [checker(_ORIGINAL, analysis.key_facts, lines) for _, checker in CHECKERS]


def test_original_as_output_fails_p2_and_p4() -> None:
    """A long passive sentence copied as one line is flagged. **Validates: Requirements 3.1**"""
    analysis = analyse(_ORIGINAL)
    lines = [Line(id="l1", text=_ORIGINAL, source_sentence_id="s1", symbol_id=None)]
    results = {r.rule: r for r in check_easy_read(_ORIGINAL, analysis.key_facts, lines)}
    assert results["P1"].passed
    assert not results["P2"].passed and results["P2"].line_ids == ["l1"]
    assert not results["P4"].passed and results["P4"].line_ids == ["l1"]


def test_no_lines_still_returns_every_rule() -> None:
    results = check_easy_read("", [], [])
    assert [r.rule for r in results] == RULES


def test_analyse_matches_sentences_and_key_facts() -> None:
    analysis = analyse(_ORIGINAL)
    sentences = split_sentences(_ORIGINAL)
    assert analysis.sentences == sentences
    assert analysis.key_facts == extract_with_sentences(_ORIGINAL, sentences)
    assert {f.type for f in analysis.key_facts} >= {"money", "date"}
    assert {f.sentence_id for f in analysis.key_facts} <= {s.id for s in sentences}


def test_extract_key_facts_matches_module_function() -> None:
    assert extract_key_facts(_ORIGINAL) == extract_with_sentences(_ORIGINAL)


def test_find_symbol_is_the_symbol_search() -> None:
    # Ranking is tested in test_symbols.py; this checks the public entry point.
    assert 1 <= len(find_symbol("doctor")) <= 5
    assert len(find_symbol("pay money", limit=1)) == 1
    assert find_symbol("the") == []


def test_long_passive_sentences_are_long_passive_and_hold_their_facts() -> None:
    """Each generator template, filled in, breaks P2 and P4 and keeps its key facts."""
    for template, slots in LONG_PASSIVE_SENTENCES:
        text = _fill_fixed(template, slots)
        assert count_words(text) > MAX_SENTENCE_WORDS, text
        line = Line(id="l1", text=text, source_sentence_id="s1", symbol_id=None)
        assert not check_p4("", [], [line]).passed, text
        types = [f.type for f in extract_key_facts(text)]
        for slot in slots:
            assert slot in types, (text, types)


_FIXED = {"money": "£45.50", "date": "1 April 2026", "reference": "AB123456", "phone": "0300 123 4567",
          "time": "10:30am"}  # fmt: skip


def _fill_fixed(template: str, slots: tuple[str, ...]) -> str:
    return template.format(o="form", a="council", pp="sent", **{s: _FIXED[s] for s in slots})
