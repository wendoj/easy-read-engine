import json

from hypothesis import given, settings
from hypothesis import strategies as st

from checks import find_symbol
from checks.config import SYMBOL_INDEX_PATH
from checks.p8_symbols import symbol_ids
from checks.symbols import index_lemmas, query_lemmas

# Queries are invented words or words from the pictogram index. No letter text.

_ENTRIES = json.loads(SYMBOL_INDEX_PATH.read_text(encoding="utf-8"))
_KEYWORDS = sorted({k for e in _ENTRIES for k in e["keywords"]})
_TAGS = sorted({t for e in _ENTRIES for t in e["tags"]})

_word = st.sampled_from(_KEYWORDS) | st.sampled_from(_TAGS)

# Index words alone or in pairs (as a `symbolQuery` is 1 or 2 words), and free
# text, including punctuation, case changes and stop words.
_queries = st.one_of(
    _word,
    st.tuples(_word, _word).map(" ".join),
    _word.map(str.upper),
    st.sampled_from(["the", "and", "you", "of", "pay", "doctor", "a letter"]),
    st.text(max_size=40),
)


# --- properties --------------------------------------------------------------


@settings(max_examples=200, deadline=None)
@given(_queries, st.integers(min_value=1, max_value=20))
def test_find_symbol_returns_only_index_ids_sorted_and_bounded(query: str, limit: int) -> None:
    """For any query, every result is a pictogram in the index, results are sorted
    by score (best first) and there are at most `limit` of them.

    **Validates: Requirements 4.1, 4.2, 4.3; P8**
    """
    matches = find_symbol(query, limit)
    known = symbol_ids()
    assert len(matches) <= limit
    assert all(m.id in known for m in matches)
    assert len({m.id for m in matches}) == len(matches)
    scores = [m.score for m in matches]
    assert scores == sorted(scores, reverse=True)
    assert all(s > 0 for s in scores)


# --- examples ----------------------------------------------------------------


def _keywords(symbol_id: str) -> list[str]:
    return next(e["keywords"] for e in _ENTRIES if e["id"] == symbol_id)


def test_exact_keyword_ranks_first() -> None:
    # "money" is a keyword of one pictogram and part of longer keywords
    # ("give money", "withdraw money") of others.
    matches = find_symbol("money", 5)
    assert "money" in [k.lower() for k in _keywords(matches[0].id)]
    assert matches[0].score > matches[1].score


def test_exact_keyword_beats_lemma_only_match() -> None:
    # A plural query matches the pictogram whose plurals contain it exactly.
    top = find_symbol("doctors", 1)[0]
    assert "doctor" in _keywords(top.id)


def test_empty_query_returns_nothing() -> None:
    assert find_symbol("", 5) == []
    assert find_symbol("   ", 5) == []


def test_stop_word_query_returns_nothing() -> None:
    assert find_symbol("the", 5) == []
    assert find_symbol("and of the", 5) == []


def test_unknown_word_returns_nothing() -> None:
    assert find_symbol("xyzzyq", 5) == []


def test_limit_is_respected() -> None:
    assert len(find_symbol("house", 2)) == 2
    assert find_symbol("house", 0) == []


def test_query_lemmas_match_the_index_lemmatiser() -> None:
    # The build script and the query share one lemmatiser.
    assert query_lemmas("paying bills!") == index_lemmas(["paying bills"])
    assert query_lemmas("the") == []
    assert index_lemmas(["up"]) == ["up"]  # the index keeps stop-word-only keywords
