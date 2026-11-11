"""Split the Original into sentences with IDs and character offsets."""

import re
from functools import lru_cache

import spacy
from spacy.language import Language

from checks.config import SPACY_MODEL
from checks.models import Sentence

# Text between blank lines (a line break, optional spaces, another line break).
_PARAGRAPH = re.compile(r"(?:(?!\n[^\S\n]*\n).)+", re.DOTALL)


@lru_cache(maxsize=1)
def get_nlp() -> Language:
    """Load the pinned spaCy model once per process."""
    return spacy.load(SPACY_MODEL)


def split_sentences(text: str) -> list[Sentence]:
    """Return the sentences of `text` in order.

    Each sentence has an ID ("s1", "s2", ...) and offsets such that
    `text[start:end] == sentence.text`. Leading and trailing whitespace is
    trimmed from each span, and whitespace-only spans are dropped.
    """
    sentences: list[Sentence] = []
    # A blank line always ends a sentence (salutations, headings, paragraphs);
    # spaCy alone would merge "Dear Ms Patel,\n\nWe have..." into one sentence.
    paragraphs = [(m.start(), m.group()) for m in _PARAGRAPH.finditer(text)]
    docs = get_nlp().pipe(p for _, p in paragraphs)
    for (offset, _), doc in zip(paragraphs, docs):
        for sent in doc.sents:
            start, end = offset + sent.start_char, offset + sent.end_char
            while start < end and text[start].isspace():
                start += 1
            while end > start and text[end - 1].isspace():
                end -= 1
            if start == end:
                continue
            sentences.append(
                Sentence(id=f"s{len(sentences) + 1}", text=text[start:end], start=start, end=end)
            )
    return sentences
