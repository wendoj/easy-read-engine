"""P7: no unexplained abbreviations.

An abbreviation is an alphabetic all-caps token of at least
`MIN_ABBREVIATION_LETTERS` letters ("PIP", "NHS"), or the same with a plural
"s" ("GPs"). Tokens with digits, such as references and postcodes ("AB123456",
"LS1"), are not abbreviations.

The first time an abbreviation appears in the output (lines in order), it must
be expanded in one of 2 ways:
- the full words, then the abbreviation in brackets:
  "Personal Independence Payment (PIP)"
- the abbreviation, then the full words in brackets:
  "PIP (Personal Independence Payment)"

The full words must start with the abbreviation's letters, in order. Small link
words with no letter of their own may appear between them
("Department for Work and Pensions (DWP)"); see `ABBREVIATION_LINK_WORDS`.
After that, the abbreviation may appear on its own. A line fails if it uses an
abbreviation that has not been expanded yet, in that line or an earlier one.

All-caps words used for emphasis ("You MUST pay") also fail; Easy Read
doesn't use capitals for emphasis.

Two kinds of capitals are copied from the letter, so they pass:
- the address lines just before a postcode that is in one of the Original's
  address key facts ("PO BOX 3, Manchester, M15 5BA"), the same run that P5
  passes (`checks/address_lines.py`). The model must not reword an address
- a placeholder of 3 or more X's that the Original also has ("XXXXXXXXX" for
  an account reference in a template letter). It stands for a value, not a
  word. A run of X's the Original doesn't have still fails

This module never logs, and `details` hold line IDs and counts, never text (R7.4).
"""

import re

from spacy.tokens import Doc, Token

from checks.address_lines import address_postcodes, address_words
from checks.config import ABBREVIATION_LINK_WORDS, MIN_ABBREVIATION_LETTERS
from checks.models import CheckResult, KeyFact, Line
from checks.sentences import get_nlp

# X's, with "." or "," between them ("XXX.XX", "XX,XXX"). At least 3 X's in all.
_PLACEHOLDER = re.compile(r"(?i)x+(?:[.,]x+)*")


def is_placeholder(token: Token, original: str) -> bool:
    """True if `token` is a run of X's that also appears in `original`.

    Template letters print "£XXX.XX" or "XXXXXXXXX" where a real letter has an
    amount or a reference. "XX" alone and a run the Original lacks don't count.
    """
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

    Every word must either give the next letter or be a link word. A link word
    may also give a letter ("Office of Others (OO)"), so both choices are tried.
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
    """True if `token` sits in one of the 2 expansion patterns in the module docstring."""
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
    """Fail every line that uses an abbreviation before it has been expanded.

    `original` and `key_facts` are used only for the capitals copied from the
    letter (module docstring): placeholders and address lines.
    """
    postcodes = address_postcodes(key_facts)
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
    return CheckResult(
        rule="P7",
        passed=not failing,
        line_ids=failing,
        failed_fact_ids=[],
        details=details,
    )
