"""Split the Original into sentences with IDs and character offsets."""

import re
from functools import lru_cache

import spacy
from spacy.language import Language

from checks.config import SPACY_MODEL
from checks.models import Sentence

# Text between blank lines (a line break, optional spaces, another line break).
_PARAGRAPH = re.compile(r"(?:(?!\n[^\S\n]*\n).)+", re.DOTALL)

# Digit groups joined by one space or one of , . / : - with no space after it:
# phone numbers ("0300 020 0040"), amounts ("1,234.50"), dates ("01/03/2026"),
# times ("9.30") and references ("AB 12 34 56"). spaCy sometimes starts a
# sentence inside one of these; a sentence never really starts there.
# "2020. 0300" is not one group, because ". " is two characters.
_DIGIT_GROUP = re.compile(r"\d+(?:(?:[^\S\n]|[,./:\-])\d+)*")
# A sentence end: . ? ! or … optionally followed by closing quotes or brackets.
_TERMINAL = re.compile(r"[.?!…][\"'”’)\]]*$")


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
    for (offset, paragraph), doc in zip(paragraphs, docs):
        spans = [_trim(paragraph, s.start_char, s.end_char) for s in doc.sents]
        for start, end in _merge_false_breaks(paragraph, [s for s in spans if s[0] < s[1]]):
            start, end = offset + start, offset + end
            sentences.append(
                Sentence(id=f"s{len(sentences) + 1}", text=text[start:end], start=start, end=end)
            )
    return sentences


def _trim(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _merge_false_breaks(paragraph: str, spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Join spaCy sentences that were split where no sentence can end.

    A break is false when the next sentence starts inside a digit group
    ("0300 020" | "0040."), or when the previous sentence has no closing
    punctuation and the next starts with a lower-case letter.
    """
    groups = [(m.start(), m.end()) for m in _DIGIT_GROUP.finditer(paragraph)]
    merged: list[tuple[int, int]] = []
    for start, end in spans:
        if merged:
            prev_start, prev_end = merged[-1]
            inside_group = any(g_start < start < g_end for g_start, g_end in groups)
            no_end = not _TERMINAL.search(paragraph[prev_start:prev_end])
            if inside_group or (no_end and paragraph[start].islower()):
                merged[-1] = (prev_start, end)
                continue
        merged.append((start, end))
    return merged
