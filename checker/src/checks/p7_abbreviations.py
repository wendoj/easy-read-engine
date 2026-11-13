"""P7: no unexplained abbreviations.

An abbreviation is an all-caps alphabetic token of at least
`MIN_ABBREVIATION_LETTERS` letters, optionally with a plural "s" ("GPs").
Its first use must read "Full Words (ABBR)" or "ABBR (Full Words)", where the
words start with its letters in order, with `ABBREVIATION_LINK_WORDS` allowed
between. All-caps emphasis ("You MUST pay") fails too.

Capitals copied from the letter pass: address words before a key-fact
postcode (`address_lines`, so "DWP, M15 5BA" added by the model still fails)
and X placeholders the Original also has.
"""

import re

from spacy.tokens import Doc, Token

from checks.address_lines import address_postcodes, address_words
from checks.config import ABBREVIATION_LINK_WORDS, MIN_ABBREVIATION_LETTERS
from checks.models import CheckResult, KeyFact, Line
from checks.results import line_result
from checks.sentences import get_nlp

# X's, with "." or "," between them ("XXX.XX", "XX,XXX"). At least 3 X's in all.
_PLACEHOLDER = re.compile(r"(?i)x+(?:[.,]x+)*")


def is_placeholder(token: Token, original: str) -> bool:
    """True if `token` is a run of 3+ X's ("£XXX.XX" in a template letter) that also appears in `original`."""
    text = token.text.strip("£$€.,")
    return (
        bool(_PLACEHOLDER.fullmatch(text))
        and sum(c in "xX" for c in text) >= 3
        and re.search(rf"(?<![\w.,]){re.escape(text)}(?![Xx]|[.,][Xx])", original) is not None
    )


def abbreviation_of(token: Token) -> str | None:
    """The abbreviation `token` spells ("GPs" gives "GP"), or None."""
    text = token.text
    if not token.is_alpha:
        return None
    if len(text) > MIN_ABBREVIATION_LETTERS and text.endswith("s") and text[:-1].isupper():
        text = text[:-1]
    if len(text) >= MIN_ABBREVIATION_LETTERS and text.isupper():
        return text
    return None


def _initials_match(letters: str, words: list[str]) -> bool:
    """True if `words` start with `letters` in order, allowing link words between.

    A link word may also give a letter ("Office of Others (OO)"), so both
    choices are tried.
    """

    def match(i: int, j: int) -> bool:
        if j == len(words):
            return i == len(letters)
        word = words[j]
        if i < len(letters) and word[0].lower() == letters[i].lower() and match(i + 1, j + 1):
            return True
        return word.lower() in ABBREVIATION_LINK_WORDS and match(i, j + 1)

    return match(0, 0)


def _words(doc: Doc, start: int, end: int) -> list[str]:
    return [t.text for t in doc[start:end] if t.is_alpha]


def is_expanded_here(token: Token, abbreviation: str) -> bool:
    doc, i = token.doc, token.i
    sent_start = token.sent.start
    # "Full Words (ABBR)": the words just before "(" end with the expansion.
    if 0 < i < len(doc) - 1 and doc[i - 1].text == "(" and doc[i + 1].text == ")":
        before = _words(doc, sent_start, i - 1)
        # Try the shortest run of words before the bracket that could hold every letter.
        for n in range(len(abbreviation), len(before) + 1):
            if _initials_match(abbreviation, before[-n:]):
                return True
    # "ABBR (Full Words)": the words inside the brackets are the expansion.
    if i + 1 < len(doc) and doc[i + 1].text == "(":
        close = next((t.i for t in doc[i + 2 :] if t.text == ")"), None)
        if close is not None and _initials_match(abbreviation, _words(doc, i + 2, close)):
            return True
    return False


def check_p7(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    postcodes = address_postcodes(original, key_facts)
    expanded: set[str] = set()
    failing: list[str] = []
    details: list[str] = []
    docs = get_nlp().pipe(line.text for line in lines)
    for line, doc in zip(lines, docs):
        unexplained = 0
        address: set[int] = set()
        if postcodes:
            for sent in doc.sents:
                address |= address_words(sent, postcodes)
        for token in doc:
            abbreviation = abbreviation_of(token)
            if abbreviation is None or abbreviation in expanded:
                continue
            if token.i in address or is_placeholder(token, original):
                continue
            if is_expanded_here(token, abbreviation):
                expanded.add(abbreviation)
            else:
                unexplained += 1
        if unexplained:
            failing.append(line.id)
            details.append(f"{line.id} has {unexplained} abbreviations that are not explained")
    return line_result("P7", failing, details)
