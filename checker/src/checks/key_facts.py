"""Key-fact extraction. Regexes find UK letter formats (`fact_patterns`), spaCy
NER adds dates, times and money they miss, and the parse finds required
actions (`actions`). P1 compares normalised values only.

Never log here: the input is letter text.
"""

import re

from spacy.tokens import Doc

from checks.actions import action_candidates, in_offer_list
from checks.fact_patterns import (
    DATE_WORD,
    HAS_DIGIT,
    RANK_NER,
    Candidate,
    address_candidates,
    collapse,
    regex_candidates,
)
from checks.models import KeyFact, KeyFactType, Sentence
from checks.sentences import get_nlp, split_sentences


def _ner_candidates(docs: list[tuple[int, Doc]]) -> list[Candidate]:
    """NER dates, times and money the regexes missed ("next Monday")."""
    out: list[Candidate] = []
    for offset, doc in docs:
        for ent in doc.ents:
            text = ent.text
            if ent.label_ == "DATE" and (HAS_DIGIT.search(text) or DATE_WORD.search(text)):
                kind: KeyFactType = "date"
            elif ent.label_ in ("TIME", "MONEY") and HAS_DIGIT.search(text):
                kind = "time" if ent.label_ == "TIME" else "money"
            else:
                continue
            normalised = re.sub(r"^the ", "", collapse(text).lower()).rstrip(".,;:")
            out.append(
                Candidate(kind, offset + ent.start_char, offset + ent.end_char, normalised,
                          RANK_NER)  # fmt: skip
            )
    return out


def _resolve_overlaps(candidates: list[Candidate]) -> list[Candidate]:
    accepted: list[Candidate] = []
    for c in sorted(candidates, key=lambda c: (c.rank, c.start - c.end, c.start)):
        if all(c.end <= a.start or c.start >= a.end for a in accepted):
            accepted.append(c)
    return accepted


def _sentence_id_for(start: int, sentences: list[Sentence]) -> str:
    chosen = sentences[0]
    for s in sentences:
        if s.start <= start:
            chosen = s
        else:
            break
    return chosen.id


def extract_key_facts(text: str, sentences: list[Sentence] | None = None) -> list[KeyFact]:
    """Every key fact in `text`, in reading order.

    Pass `split_sentences(text)` as `sentences` to avoid splitting twice.
    """
    if sentences is None:
        sentences = split_sentences(text)
    if not sentences:
        return []

    docs = list(zip((s.start for s in sentences), get_nlp().pipe(s.text for s in sentences)))
    facilities = [
        (offset + ent.start_char, offset + ent.end_char)
        for offset, doc in docs
        for ent in doc.ents
        if ent.label_ == "FAC"
    ]

    facts = _resolve_overlaps(
        regex_candidates(text) + address_candidates(text, facilities) + _ner_candidates(docs)
    )
    facts += [c for c in action_candidates(docs, facts) if not in_offer_list(text, c.start)]
    facts.sort(key=lambda c: (c.start, c.end, c.type))

    return [
        KeyFact(
            id=f"k{i}",
            type=c.type,
            value=text[c.start : c.end],
            normalised=c.normalised,
            start=c.start,
            end=c.end,
            sentence_id=_sentence_id_for(c.start, sentences),
        )
        for i, c in enumerate(facts, start=1)
    ]
