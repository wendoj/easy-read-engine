"""Address lines before a key-fact postcode, shared by P5 and P7.

P1 finds an address by its postcode, so the address key fact holds only the
postcode ("CB7 4EE"). The lines before it ("The Grange, Nutholt Lane, Ely")
are copied from the letter, so P5 and P7 don't fail them: the model must not
reword an address to pass a plain-words or abbreviation check ("PO BOX 3,
Manchester, M15 5BA").

This module never logs (R7.4).
"""

import re

from spacy.tokens import Span

from checks.models import KeyFact

# A UK postcode, as P1's address key facts find it ("CB7 4EE").
POSTCODE = re.compile(r"(?i)\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[ABD-HJLNP-UW-Z]{2}\b")


def address_postcodes(key_facts: list[KeyFact]) -> frozenset[str]:
    """Postcodes of the Original's address key facts, upper case without spaces."""
    return frozenset(
        re.sub(r"\s", "", m.group()).upper()
        for f in key_facts
        if f.type == "address"
        for m in POSTCODE.finditer(f.value)
    )


def address_words(sent: Span, postcodes: frozenset[str]) -> set[int]:
    """Token indexes of the address lines before a key-fact postcode.

    Walks back from the postcode over capitalised words, numbers and commas,
    and stops at the first other word: in "Send it to The Grange, Nutholt
    Lane, Ely, CB7 4EE." that is "to". P1 checks the postcode but not these
    words, so a changed address part would go unnoticed.
    """
    found: set[int] = set()
    for m in POSTCODE.finditer(sent.text):
        if re.sub(r"\s", "", m.group()).upper() not in postcodes:
            continue
        start = sent.start_char + m.start()
        tokens = [t for t in sent if t.idx < start]
        for token in reversed(tokens):
            if token.text == "," or token.text[:1].isupper() or token.text[:1].isdigit():
                found.add(token.i)
            else:
                break
    return found
