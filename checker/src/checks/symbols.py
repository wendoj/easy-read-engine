"""Pictogram search over the committed ARASAAC index.

    score = (keyword hits + TAG_WEIGHT * tag-only hits) / query lemmas
          + SPECIFICITY_WEIGHT * keyword hits / pictogram lemmas
          + EXACT_BONUS if the query equals one of the pictogram's keywords or plurals

Keyword hits are query lemmas in the entry's `lemmas` (from its keywords and
plurals). Tags are broad, so they count for less and can never reach the web
app's `SYMBOL_MIN_SCORE` on their own. The specificity term prefers "money"
over "money box" for the query "money". Queries are lemmatised with the same
helper as the build script. Every returned ID is in the index, so P8 passes.
"""

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache

from spacy.tokens import Doc

from checks.config import SYMBOL_INDEX_PATH
from checks.models import SymbolMatch
from checks.sentences import get_nlp

TAG_WEIGHT = 0.25
SPECIFICITY_WEIGHT = 0.25
EXACT_BONUS = 0.5

# spaCy components not needed for lemmas. The build script uses the same
# setting, so query and index lemmas come from the same pipeline.
_DISABLED = ("parser", "ner")

_SPACE = re.compile(r"\s+")


def _unique(items: Iterable[str]) -> list[str]:
    """Keep the first copy of each non-empty item, in order."""
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _doc_lemmas(doc: Doc, *, keep_stop_words_if_empty: bool) -> list[str]:
    words = [t for t in doc if not (t.is_punct or t.is_space)]
    content = [t for t in words if not t.is_stop]
    if not content and keep_stop_words_if_empty:
        content = words
    return [t.lemma_.lower() for t in content]


def phrase_lemmas(phrases: Iterable[str], *, keep_stop_words_if_empty: bool = True) -> list[list[str]]:
    """Lemmas of each phrase: lower case, punctuation and stop words removed.

    With `keep_stop_words_if_empty`, a phrase of stop words only keeps them
    (the index does this, so a pictogram for "up" still has a lemma).
    """
    docs = get_nlp().pipe(list(phrases), disable=list(_DISABLED))
    return [_doc_lemmas(doc, keep_stop_words_if_empty=keep_stop_words_if_empty) for doc in docs]


def index_lemmas(phrases: list[str]) -> list[str]:
    """The `lemmas` field of an index entry: unique lemmas of its keywords and plurals."""
    return _unique(lemma for lemmas in phrase_lemmas(phrases) for lemma in lemmas)


def query_lemmas(query: str) -> list[str]:
    """Unique lemmas of a search query. Stop words only gives []."""
    return _unique(phrase_lemmas([query], keep_stop_words_if_empty=False)[0])


def _normalise(phrase: str) -> str:
    return _SPACE.sub(" ", phrase).strip().strip(".,;:!?\"'").strip().lower()


@dataclass(frozen=True)
class _Entry:
    id: str
    lemmas: frozenset[str]
    tag_lemmas: frozenset[str]
    exact: frozenset[str]


@dataclass(frozen=True)
class SearchIndex:
    entries: tuple[_Entry, ...]
    by_lemma: dict[str, tuple[int, ...]]
    by_tag_lemma: dict[str, tuple[int, ...]]
    by_exact: dict[str, tuple[int, ...]]


def _postings(pairs: Iterable[tuple[str, int]]) -> dict[str, tuple[int, ...]]:
    out: dict[str, list[int]] = {}
    for key, i in pairs:
        bucket = out.setdefault(key, [])
        if not bucket or bucket[-1] != i:
            bucket.append(i)
    return {k: tuple(v) for k, v in out.items()}


@lru_cache(maxsize=1)
def search_index() -> SearchIndex:
    """Load the symbol index and build the inverted indexes, once per process."""
    raw = json.loads(SYMBOL_INDEX_PATH.read_text(encoding="utf-8"))
    tags = _unique(t for e in raw for t in e["tags"])
    tag_lemmas = dict(zip(tags, phrase_lemmas(tags)))
    entries = tuple(
        _Entry(
            id=e["id"],
            lemmas=frozenset(e["lemmas"]),
            tag_lemmas=frozenset(lemma for t in e["tags"] for lemma in tag_lemmas[t]),
            exact=frozenset(_normalise(p) for p in e["keywords"] + e["plurals"] if _normalise(p)),
        )
        for e in raw
    )
    return SearchIndex(
        entries=entries,
        by_lemma=_postings((lemma, i) for i, e in enumerate(entries) for lemma in sorted(e.lemmas)),
        by_tag_lemma=_postings((lemma, i) for i, e in enumerate(entries) for lemma in sorted(e.tag_lemmas)),
        by_exact=_postings((p, i) for i, e in enumerate(entries) for p in sorted(e.exact)),
    )


def _score(entry: _Entry, query: frozenset[str], exact: bool) -> float:
    keyword_hits = len(query & entry.lemmas)
    tag_hits = len((query - entry.lemmas) & entry.tag_lemmas)
    coverage = (keyword_hits + TAG_WEIGHT * tag_hits) / len(query)
    specificity = keyword_hits / len(entry.lemmas) if entry.lemmas else 0.0
    return coverage + SPECIFICITY_WEIGHT * specificity + (EXACT_BONUS if exact else 0.0)


def find_symbol(query: str, limit: int = 5) -> list[SymbolMatch]:
    """Pictograms for `query`, best score first, at most `limit`.

    Equal scores are ordered by ID, so results are deterministic. An empty
    list means no picture fits.
    """
    lemmas = frozenset(query_lemmas(query))
    if not lemmas or limit < 1:
        return []
    index = search_index()
    phrase = _normalise(query)
    exact = set(index.by_exact.get(phrase, ()))
    candidates: set[int] = set(exact)
    for lemma in lemmas:
        candidates.update(index.by_lemma.get(lemma, ()))
        candidates.update(index.by_tag_lemma.get(lemma, ()))
    scored = [
        (round(_score(index.entries[i], lemmas, i in exact), 4), index.entries[i].id) for i in candidates
    ]
    scored.sort(key=lambda s: (-s[0], len(s[1]), s[1]))
    return [SymbolMatch(id=i, score=score) for score, i in scored[:limit]]
