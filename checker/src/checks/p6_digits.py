"""P6: numbers are written as digits.

A line fails on any alphabetic token spaCy marks `like_num` ("three",
"twenty"). Ordinals pass: "the first time" is plain English and "second" is
also a unit of time.

Known limit: the pronoun "one" ("no one") fails, because spaCy marks it
`like_num` too.
"""

from spacy.lang.en.lex_attrs import _ordinal_words
from spacy.tokens import Token

from checks.models import CheckResult, KeyFact, Line
from checks.results import line_result
from checks.sentences import get_nlp

ORDINAL_WORDS = frozenset(_ordinal_words)


def is_number_word(token: Token) -> bool:
    return token.is_alpha and token.like_num and token.lower_ not in ORDINAL_WORDS


def check_p6(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    del original, key_facts
    failing: list[str] = []
    details: list[str] = []
    docs = get_nlp().pipe(line.text for line in lines)
    for line, doc in zip(lines, docs):
        count = sum(1 for token in doc if is_number_word(token))
        if count:
            failing.append(line.id)
            details.append(f"{line.id} has {count} numbers written in words")
    return line_result("P6", failing, details)
