"""Address lines before a key-fact postcode, which P5 and P7 let pass.

The address key fact holds only the postcode, but the model must copy the
lines before it, not reword them to pass P5 or P7. Only words the Original
has in its own address text before that postcode pass, so a word the model
added ("Write to DWP, M15 5BA.") is checked like any other.
"""

import re

from spacy.tokens import Span

from checks.models import KeyFact

# A UK postcode, as P1's address key facts find it ("CB7 4EE").
POSTCODE = re.compile(r"(?i)\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[ABD-HJLNP-UW-Z]{2}\b")

# How far back from the postcode the Original's address text may start. A long
# council address ("Revenues and Benefits, PO Box 532, Town Hall, Manchester,")
# is under 100 characters.
ADDRESS_WINDOW_CHARS = 200

# Where the address text starts: after a sentence end or a blank line.
_ADDRESS_START = re.compile(r"[.!?](?=\s)|\n[ \t]*\n")


def _postcode_key(text: str) -> str:
    return re.sub(r"\s", "", text).upper()


def address_postcodes(original: str, key_facts: list[KeyFact]) -> dict[str, str]:
    """The Original's address text before each address key-fact postcode.

    Keys are postcodes in upper case without spaces. Values are the lower-case
    text before that postcode in the Original, joined with a newline when the
    same postcode appears more than once. A key fact whose span doesn't fit
    `original` gives an empty text, so its address words are checked as usual.
    """
    found: dict[str, list[str]] = {}
    for f in key_facts:
        if f.type != "address":
            continue
        span_ok = 0 <= f.start <= f.end <= len(original) and original[f.start : f.end] == f.value
        window = original[max(0, f.start - ADDRESS_WINDOW_CHARS) : f.start] if span_ok else ""
        starts = list(_ADDRESS_START.finditer(window))
        if starts:
            window = window[starts[-1].end() :]
        for m in POSTCODE.finditer(f.value):
            found.setdefault(_postcode_key(m.group()), []).append(window.lower())
    return {postcode: "\n".join(texts) for postcode, texts in found.items()}


def _in_text(token: str, text: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(token.lower())}(?!\w)", text) is not None


def address_words(sent: Span, postcodes: dict[str, str]) -> set[int]:
    """Token indexes of the address lines before a key-fact postcode.

    Walks back from the postcode over commas and over capitalised words and
    numbers that the Original's address text has (`address_postcodes`), and
    stops at the first other token: in "Send it to The Grange, Nutholt Lane,
    Ely, CB7 4EE." that is "to". P1 checks the postcode but not these words,
    so the model must copy them, not reword them.
    """
    found: set[int] = set()
    for m in POSTCODE.finditer(sent.text):
        address_text = postcodes.get(_postcode_key(m.group()))
        if address_text is None:
            continue
        start = sent.start_char + m.start()
        tokens = [t for t in sent if t.idx < start]
        for token in reversed(tokens):
            copied = (token.text[:1].isupper() or token.text[:1].isdigit()) and _in_text(token.text, address_text)
            if token.text == "," or copied:
                found.add(token.i)
            else:
                break
    return found
