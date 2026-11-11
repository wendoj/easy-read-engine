"""Checker configuration. Pinned values keep test results reproducible."""

from pathlib import Path

# Must match the wheel pinned in pyproject.toml (en_core_web_sm 3.8.0).
SPACY_MODEL = "en_core_web_sm"

# P2: the most words a sentence may have. A starting value to tune against
# real Easy Read documents, not a published limit. See p2_sentence_length.py
# for how words are counted.
MAX_SENTENCE_WORDS = 15

# Key-fact actions, version 1 (design "Key-fact extraction and normalisation").
# Common Easy Read swaps for a required action's verb. Keys are spaCy lemmas,
# with phrasal verbs written as "verb particle". A key can also be a verb and
# its object ("make a payment"): the object is used up by the swap, so "Make a
# payment of £45" and "Pay £45" give the same action. Swaps don't chain. Kept
# short on purpose, with only clear same-meaning pairs, and listed in the rule
# report, so no one is surprised by what P1 accepts.
ACTION_SYNONYMS: dict[str, str] = {
    "contact": "phone",
    "call": "phone",
    "ring": "phone",
    "telephone": "phone",
    "submit": "send",
    "return": "send back",
    "complete": "fill in",
    "fill out": "fill in",
    "provide": "give",
    "inform": "tell",
    "notify": "tell",
    "make a payment": "pay",
    "make an application": "apply",
    "respond": "reply",
    "write back": "reply",
    "attend": "go",
    "request": "ask",
    "obtain": "get",
    "retain": "keep",
}

# Verb lemmas that look like imperatives in letters but ask for no action
# ("Thank you for...", "Please note...", "Please find enclosed...").
NON_ACTION_VERBS: frozenset[str] = frozenset({"thank", "note", "find"})

# P3: the most main verb clauses a sentence may have. See p3_one_idea.py for
# what counts as a clause.
MAX_CLAUSES_PER_SENTENCE = 1
# P3: reporting verbs. "The letter says you must pay £45." is one idea (what
# the letter says), so the clause after one of these verbs is not counted when
# the subject is the letter, a named sender or "it". Easy Read rules list this
# wording as the allowed way to report what a letter asks.
REPORTING_VERBS: frozenset[str] = frozenset({"say", "tell", "show", "mean", "think", "know"})

# P4: past participles that read as adjectives after "you are ... to" ("You
# are entitled to Housing Benefit.", "You are required to pay."). They describe
# the reader's state, not an action done to them, and have no plain active
# form, so P4 lets them pass when there is no "by ..." agent. Lemmas.
STATAL_PARTICIPLES: frozenset[str] = frozenset(
    {"entitle", "require", "allow", "suppose", "expect"}
)

# P5: common-word list files in checks/wordlist/ (sources and licences in its
# README.md). A word passes if its lemma or its written form is in any of them.
WORDLIST_FILES: tuple[str, ...] = (
    "ngsl-1.2-lemmatized-for-research.csv",
    "ngsl-1.2-supplement-lemmatized.csv",
    "extra.txt",
)
# P5: names of people, organisations and places are not "hard words", so
# tokens inside a spaCy entity with one of these labels pass.
NAME_ENTITY_LABELS: frozenset[str] = frozenset({"PERSON", "ORG", "GPE", "LOC", "FAC", "NORP"})
# P5: verb lemmas that define their subject on first use ("X means ...", "X is ...").
DEFINING_VERBS: frozenset[str] = frozenset({"be", "mean"})

# P7: the fewest letters in an all-caps token that P7 treats as an abbreviation.
MIN_ABBREVIATION_LETTERS = 2
# P7: small words an expansion may contain that have no letter in the
# abbreviation ("Department for Work and Pensions (DWP)").
ABBREVIATION_LINK_WORDS: frozenset[str] = frozenset(
    {"a", "an", "and", "&", "for", "in", "of", "on", "the", "to"}
)

# P8 and find_symbol: the committed ARASAAC index, built by
# scripts/build_symbol_index.py (design "Symbols").
SYMBOL_INDEX_PATH = Path(__file__).resolve().parents[2] / "data" / "symbols.json"

# HTTP adapter request bounds. The web app rejects letters over 1,500 words
# (R1.7); these limits leave a margin above that and stop oversized requests
# before any parsing work.
MAX_ORIGINAL_CHARS = 20_000
MAX_LINES = 400
MAX_LINE_CHARS = 1_000
MAX_KEY_FACTS = 1_000
MAX_ID_CHARS = 64
MAX_SYMBOL_QUERY_CHARS = 200
MAX_SYMBOL_LIMIT = 20
