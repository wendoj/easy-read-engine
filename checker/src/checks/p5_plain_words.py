"""P5: plain words.

Every word in the output must be a common word, or be explained the first time
it is used. A word token passes if any of these is true:

- its lemma or its written form (lower case) is in the common-word list
  (`WORDLIST_FILES` in `checks/wordlist/`, sources in its README)
- it is a number, or holds a digit ("£45", "14", "AB123456")
- it is part of a key fact's value, for every key-fact type except "action"
  (an address's street name, for example). Actions are excluded because their
  wording is meant to change, and P1 already compares them by lemma
- it is part of a name: a spaCy entity labelled `NAME_ENTITY_LABELS`
  ("Manchester City Council", "Citizens Advice"), a capitalised proper
  noun that doesn't start its sentence, or a word with a capital inside it
  ("StepChange", "PayPoint")
- it is a single capital letter used as a label ("Band A")
- it is a web or email address
- it is an abbreviation in capitals; P7 checks those
- it has been defined on first use (below)
- it is joined by hyphens from common words. spaCy splits "cross-examine" at
  an ASCII hyphen but not at a non-breaking one (U+2011), so this treats both
  the same. "pre‑inquiry" still fails: "pre" is not a word on the list

Defined on first use. A sentence whose main verb is "mean" or "be" defines
the words in its subject: "**Your rent** is the money you pay to live in your
home." After that sentence, those words pass in the same line and every later
line. A hard word used before its definition fails. "X is ..." counts only
when a noun follows "is", so "Your arrears are £120." defines nothing.

Known limits: any "X is a <noun> ..." sentence counts as a definition, even
one that explains little ("Your liability is a problem."). The words of the
definition itself are checked like any other words.

Punctuation, symbols and spaces are not words. Short forms ("'ll", "n't",
"'re", "'ve", with straight or curly apostrophes) are checked as the word they
stand for.

This module never logs, and `details` hold line IDs and counts, never text (R7.4).
"""

import re
from functools import lru_cache
from pathlib import Path

from spacy.tokens import Span, Token

from checks.config import DEFINING_VERBS, NAME_ENTITY_LABELS, WORDLIST_FILES
from checks.models import CheckResult, KeyFact, Line
from checks.p7_abbreviations import abbreviation_of
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
    """All words in the common-word list files, lower case.

    The NGSL files are CSV rows of a headword and its forms, with `##`
    comment lines. `extra.txt` has one word per line and `#` comments.
    """
    words: set[str] = set()
    for name in WORDLIST_FILES:
        text = (WORDLIST_DIR / name).read_text(encoding="utf-8-sig")
        for row in text.splitlines():
            if row.lstrip().startswith("#"):
                continue
            words.update(w.strip().lower() for w in row.split(",") if w.strip())
    return frozenset(words)


def _key_fact_words(key_facts: list[KeyFact]) -> frozenset[str]:
    return frozenset(
        w.lower() for f in key_facts if f.type != "action" for w in _WORD.findall(f.value)
    )


def _forms(token: Token) -> set[str]:
    forms = {token.lemma_.lower().translate(_APOSTROPHES), token.lower_.translate(_APOSTROPHES)}
    return forms | {_CONTRACTIONS[f] for f in forms if f in _CONTRACTIONS}


def _common_parts(token: Token, words: frozenset[str]) -> bool:
    """Whether a hyphenated token is made only of common words.

    spaCy splits "cross-examine" at an ASCII hyphen and checks each part, but
    keeps "cross‑examine" (non-breaking hyphen, U+2011) as 1 token. This checks
    that token's parts the same way.
    """
    text = token.lower_.translate(_APOSTROPHES)
    parts = [p for p in text.split("-") if p]
    return "-" in text and bool(parts) and all(p in words for p in parts)


def _needs_checking(token: Token, fact_words: frozenset[str]) -> bool:
    """False for tokens that pass whatever they say (see the module docstring)."""
    if not any(c.isalpha() for c in token.text):
        return False  # punctuation, symbols, spaces and plain numbers
    if any(c.isdigit() for c in token.text) or token.like_num:
        return False
    if token.like_url or token.like_email:
        return False
    if abbreviation_of(token) is not None:
        return False
    if token.ent_type_ in NAME_ENTITY_LABELS:
        return False
    # A name spaCy didn't tag as an entity ("StepChange", "PayPoint"): a
    # capitalised proper noun that doesn't start the sentence, or a word with
    # a capital inside it, which can start one ("StepChange can help.").
    if token.pos_ == "PROPN" and token.text[:1].isupper() and not token.is_sent_start:
        return False
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
    """The subject words that `sent` defines, or [] if it is not a definition.

    "X means ..." needs an object or clause after "means". "X is ..." needs a
    noun after "is" ("the money ..."), so "Your arrears are £120." and "Your
    liability is high." don't count as definitions.
    """
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
    """Fail every line with a word that is not common and not yet defined.

    `key_facts` are the Original's key facts; their non-action words pass.
    `original` is unused. It is kept so every checker has the same signature.
    """
    del original
    words = common_words()
    fact_words = _key_fact_words(key_facts)
    defined: set[str] = set()
    failing: list[str] = []
    details: list[str] = []
    docs = get_nlp().pipe(line.text for line in lines)
    for line, doc in zip(lines, docs):
        hard = 0
        for sent in doc.sents:
            for token in _defined_words(sent):
                defined.update(_forms(token))
            for token in sent:
                if not _needs_checking(token, fact_words):
                    continue
                forms = _forms(token)
                if forms & words or forms & defined or forms & _CLITICS or _common_parts(token, words):
                    continue
                hard += 1
        if hard:
            failing.append(line.id)
            details.append(f"{line.id} has {hard} words that are not common and not explained")
    return CheckResult(
        rule="P5",
        passed=not failing,
        line_ids=failing,
        failed_fact_ids=[],
        details=details,
    )
