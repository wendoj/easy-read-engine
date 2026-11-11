"""Checker configuration. Pinned values keep test results reproducible."""

# Must match the wheel pinned in pyproject.toml (en_core_web_sm 3.8.0).
SPACY_MODEL = "en_core_web_sm"

# P2: the most words a sentence may have. A starting value to tune against
# real Easy Read documents, not a published limit. See p2_sentence_length.py
# for how words are counted.
MAX_SENTENCE_WORDS = 15

# Key-fact actions, version 1 (design "Key-fact extraction and normalisation").
# Common Easy Read swaps for a required action's verb. Keys are spaCy lemmas,
# with phrasal verbs written as "verb particle". Kept short on purpose, and
# listed in the rule report, so no one is surprised by what P1 accepts.
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
}

# Verb lemmas that look like imperatives in letters but ask for no action
# ("Thank you for...", "Please note...", "Please find enclosed...").
NON_ACTION_VERBS: frozenset[str] = frozenset({"thank", "note", "find"})
