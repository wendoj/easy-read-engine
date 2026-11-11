"""P6: numbers are written as digits.

A line fails if any token is alphabetic and spaCy marks it `like_num`:
"three", "twenty", "hundred", and each part of "twenty-one". Digits ("3",
"£45", "14 March 2026") pass.

Ordinal words ("first", "second", "third") are allowed. spaCy marks them
`like_num`, but they are ordinary words in Easy Read ("the first time"), and
"second" is also a unit of time.

Known limit: "one" used as a pronoun ("no one", "a new one") fails, because
spaCy marks it `like_num` too. Rewording ("nobody") passes.

This module never logs, and `details` hold line IDs and counts, never text (R7.4).
"""

from spacy.lang.en.lex_attrs import _ordinal_words
from spacy.tokens import Token

from checks.models import CheckResult, KeyFact, Line
from checks.sentences import get_nlp

ORDINAL_WORDS = frozenset(_ordinal_words)


def is_number_word(token: Token) -> bool:
    """True if `token` is a number written in letters (and not an ordinal)."""
    return token.is_alpha and token.like_num and token.lower_ not in ORDINAL_WORDS


def check_p6(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    """Fail every line with a number written in letters.

    `original` and `key_facts` are unused. They are kept so every checker has
    the same signature.
    """
    del original, key_facts
    failing: list[str] = []
    details: list[str] = []
    docs = get_nlp().pipe(line.text for line in lines)
    for line, doc in zip(lines, docs):
        count = sum(1 for token in doc if is_number_word(token))
        if count:
            failing.append(line.id)
            details.append(f"{line.id} has {count} numbers written in words")
    return CheckResult(
        rule="P6",
        passed=not failing,
        line_ids=failing,
        failed_fact_ids=[],
        details=details,
    )
