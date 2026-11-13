"""P5: every word is common, or explained the first time it is used.

A word passes if its lemma or form is in the `WORDLIST_FILES`, or it holds a
digit, is in a non-action key fact's value, is a name (an entity in
`NAME_ENTITY_LABELS`, a word with an inner capital like "StepChange", or a
name in `names.txt` written exactly as listed), is an address word copied
before a key-fact postcode (`address_lines`), is a single-capital label
("Band A"), a web or email address, a placeholder the Original also has, an
abbreviation (P7 checks those), or is joined by hyphens from common words.
A Title Case word on its own is checked, so "Enforcement Agent" fails. Add a
word to `names.txt` only if it is a name.

A sentence whose root is "mean" or "be" + noun defines the words in its
subject for that line and every later line ("Your rent is the money ...").
"Your arrears are £120." defines nothing.

`details` hold line IDs and counts, never the word.
"""

import re
from functools import lru_cache
from pathlib import Path

from spacy.tokens import Span, Token

from checks.address_lines import address_postcodes, address_words
from checks.config import DEFINING_VERBS, NAME_ENTITY_LABELS, NAMES_FILE, WORDLIST_FILES
from checks.models import CheckResult, KeyFact, Line
from checks.p7_abbreviations import abbreviation_of, is_placeholder
from checks.results import line_result
from checks.sentences import get_nlp

WORDLIST_DIR = Path(__file__).parent / "wordlist"
_WORD = re.compile(r"[^\W\d_]+")
# Curly apostrophes, and the non-breaking hyphen (U+2011) models often write
# in "e‑mail" and "pre‑inquiry".
_APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "\u2011": "-", "\u2010": "-"})
# Short forms and the word each stands for. spaCy leaves some of them, most
# often with a curly apostrophe ("you’ll", "don’t"), as their own lemma.
_CONTRACTIONS = {"'ll": "will", "n't": "not", "'re": "be", "'ve": "have", "'d": "would", "'m": "be"}
# The possessive "'s" keeps "'s" as its lemma.
_CLITICS = frozenset({"'s", "'"})
# What can follow "means" in a definition: "X means the money ...", "X means you ...".
_MEANING_DEPS = frozenset({"dobj", "attr", "ccomp", "xcomp"})


@lru_cache(maxsize=1)
def common_words() -> frozenset[str]:
    """Lower-case words from the list files: NGSL CSV rows (headword, forms) and `extra.txt` lines."""
    words: set[str] = set()
    for name in WORDLIST_FILES:
        text = (WORDLIST_DIR / name).read_text(encoding="utf-8-sig")
        for row in text.splitlines():
            if row.lstrip().startswith("#"):
                continue
            words.update(w.strip().lower() for w in row.split(",") if w.strip())
    return frozenset(words)


@lru_cache(maxsize=1)
def listed_names() -> frozenset[str]:
    text = (WORDLIST_DIR / NAMES_FILE).read_text(encoding="utf-8")
    return frozenset(r.strip() for r in text.splitlines() if r.strip() and not r.lstrip().startswith("#"))


def _key_fact_words(key_facts: list[KeyFact]) -> frozenset[str]:
    return frozenset(
        w.lower() for f in key_facts if f.type != "action" for w in _WORD.findall(f.value)
    )


def _forms(token: Token) -> set[str]:
    forms = {token.lemma_.lower().translate(_APOSTROPHES), token.lower_.translate(_APOSTROPHES)}
    return forms | {_CONTRACTIONS[f] for f in forms if f in _CONTRACTIONS}


def _common_parts(token: Token, words: frozenset[str]) -> bool:
    """Whether a hyphenated token is made only of common words.

    spaCy splits at an ASCII hyphen but keeps "cross‑examine" (U+2011) as 1
    token, so its parts are checked here.
    """
    text = token.lower_.translate(_APOSTROPHES)
    parts = [p for p in text.split("-") if p]
    return "-" in text and bool(parts) and all(p in words for p in parts)


def _needs_checking(token: Token, fact_words: frozenset[str]) -> bool:
    """False for tokens that pass whatever they say. Address words are handled in `check_p5`."""
    if not any(c.isalpha() for c in token.text):
        return False
    if any(c.isdigit() for c in token.text) or token.like_num:
        return False
    if token.like_url or token.like_email:
        return False
    if abbreviation_of(token) is not None:
        return False
    if token.ent_type_ in NAME_ENTITY_LABELS:
        return False
    if token.text in listed_names():
        return False
    # A name spaCy didn't tag as an entity ("StepChange", "PayPoint"): a word
    # with a capital inside it, which can start a sentence ("StepChange can
    # help."). A Title Case word alone is not a name: letters write legal
    # terms that way ("Enforcement Agent", "Committal Order").
    if token.is_alpha and token.text[:1].isupper() and any(c.isupper() for c in token.text[1:]) and any(
        c.islower() for c in token.text
    ):
        return False
    # A single capital letter used as a label: "Band A", "Form B".
    letters = [c for c in token.text if c.isalpha()]
    if len(letters) == 1 and letters[0].isupper():
        return False
    if token.lower_ in fact_words:
        return False
    return True


def _defined_words(sent: Span) -> list[Token]:
    """The subject words that `sent` defines, or [] if it is not a definition."""
    root = sent.root
    lemma = root.lemma_.lower()
    if lemma not in DEFINING_VERBS:
        return []
    children = list(root.children)
    if lemma == "mean":
        explained = any(c.dep_ in _MEANING_DEPS for c in children)
    else:
        explained = any(c.dep_ == "attr" and c.pos_ == "NOUN" for c in children)
    if not explained:
        return []
    return [t for c in children if c.dep_ in ("nsubj", "nsubjpass") for t in c.subtree]


def check_p5(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    words = common_words()
    fact_words = _key_fact_words(key_facts)
    postcodes = address_postcodes(original, key_facts)
    defined: set[str] = set()
    failing: list[str] = []
    details: list[str] = []
    docs = get_nlp().pipe(line.text for line in lines)
    for line, doc in zip(lines, docs):
        hard = 0
        for sent in doc.sents:
            for token in _defined_words(sent):
                defined.update(_forms(token))
            address = address_words(sent, postcodes) if postcodes else set()
            for token in sent:
                if token.i in address or not _needs_checking(token, fact_words):
                    continue
                if is_placeholder(token, original):
                    continue
                forms = _forms(token)
                if forms & words or forms & defined or forms & _CLITICS or _common_parts(token, words):
                    continue
                hard += 1
        if hard:
            failing.append(line.id)
            details.append(f"{line.id} has {hard} words that are not common and not explained")
    return line_result("P5", failing, details)
