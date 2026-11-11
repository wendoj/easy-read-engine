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

# Words a sentence can't end on. A line that ends on one of these wraps into
# the next line, even when the next line starts with a capital ("contact
# the\nCouncil Tax team").
_CONTINUING_WORDS = frozenset(
    """a an the of to and or but nor for with by on at in into onto from as if than
    your our their his her its my this that these those which who whom whose
    is are was were be been being will would can could may might must should shall
    have has had do does did not no per via about over under within without between
    such including like please""".split()
)
# A line that starts with a web address or email ("angliarevenues.gov.uk/...").
_WEB_START = re.compile(r"(?i)(?:https?://|www\.|[\w-]+(?:\.[\w-]+)+/|[\w.+-]+@[\w-]+\.)")
# Bullet and dash marks that start a list item.
_BULLETS = frozenset("•◦▪‣*-–−")
# A wrapped line of prose is close to the full width of its paragraph. A
# shorter line followed by a capital is a layout line: a heading, a label or a
# table cell.
_SHORT_LINE = 0.8


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
    # Inside a paragraph, a single line break also ends a sentence where the
    # text is laid out in lines (labels, headings, table cells, web
    # addresses) rather than wrapped prose. Letters from PDFs are full of
    # these, and spaCy alone joins them into one long "sentence".
    paragraphs = [
        (m.start() + start, m.group()[start:end])
        for m in _PARAGRAPH.finditer(text)
        for start, end in _layout_blocks(m.group())
    ]
    docs = get_nlp().pipe(p for _, p in paragraphs)
    for (offset, paragraph), doc in zip(paragraphs, docs):
        spans = [_trim(paragraph, s.start_char, s.end_char) for s in doc.sents]
        for start, end in _merge_false_breaks(paragraph, [s for s in spans if s[0] < s[1]]):
            start, end = offset + start, offset + end
            sentences.append(
                Sentence(id=f"s{len(sentences) + 1}", text=text[start:end], start=start, end=end)
            )
    return sentences


def _layout_blocks(paragraph: str) -> list[tuple[int, int]]:
    """Split a paragraph at layout line breaks, keeping wrapped prose together.

    Offsets are into `paragraph`. A paragraph with no layout break comes back
    whole.
    """
    lines: list[tuple[int, int]] = []
    pos = 0
    for line in paragraph.split("\n"):
        lines.append((pos, pos + len(line)))
        pos += len(line) + 1
    # Width in words, not characters: PDF text often holds long runs of spaces.
    widest = max(_width(paragraph[s:e]) for s, e in lines)
    blocks: list[tuple[int, int]] = []
    start = 0
    for (p_start, p_end), (n_start, n_end) in zip(lines, lines[1:]):
        prev = paragraph[p_start:p_end].strip()
        nxt = paragraph[n_start:n_end].strip()
        if prev and nxt and _is_layout_break(prev, nxt, widest):
            blocks.append((start, p_end))
            start = n_start
    blocks.append((start, len(paragraph)))
    return blocks


def _is_layout_break(prev: str, nxt: str, widest: int) -> bool:
    """Whether the line break between two non-empty lines ends a sentence.

    It does after a colon, a sentence end or a line that is only a web
    address, and before a bullet or a web address. Before a capital or a digit it does too, unless the line before
    ends on a word a sentence can't end on, or it is a long, wrapped line that
    ends on a capitalised word (a name running onto the next line: "your
    Council\nTax bill", "Data Protection Act\n2018").
    """
    if prev.endswith(":") or _TERMINAL.search(prev):
        return True
    if nxt[0] in _BULLETS or _WEB_START.match(nxt):
        return True
    if " " not in prev and _WEB_START.match(prev):
        return True
    if not (nxt[0].isupper() or nxt[0].isdigit()):
        return False
    last = prev.split()[-1].strip(",;-–")
    if prev.endswith((",", ";", "-", "–")) or last.lower() in _CONTINUING_WORDS:
        return False
    wrapped = _width(prev) >= _SHORT_LINE * widest
    return not (wrapped and last[:1].isupper())


def _width(line: str) -> int:
    """Length of a line with each run of whitespace counted as one space."""
    return len(" ".join(line.split()))


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
