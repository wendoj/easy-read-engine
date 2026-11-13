"""Required actions found in the dependency parse, for key-fact extraction."""

import re

from spacy.tokens import Doc, Token

from checks.config import ACTION_SYNONYMS, NON_ACTION_VERBS
from checks.fact_patterns import Candidate

_ACTION_FACT_TYPES = ("date", "money")
_PARTICLES = frozenset({"back", "in", "out", "up", "off", "down", "away"})
_SUBJECT_DEPS = ("nsubj", "nsubjpass", "csubj", "csubjpass", "expl")
_DASHES = frozenset({"-", "–", "—", "‒"})


def _has_you_subject(tok: Token, deps: tuple[str, ...] = ("nsubj",)) -> bool:
    return any(c.dep_ in deps and c.lower_ == "you" for c in tok.children)


def _xcomp_verb(tok: Token) -> Token | None:
    return next((c for c in tok.children if c.dep_ == "xcomp" and c.pos_ == "VERB"), None)


def _has_you_object(tok: Token) -> bool:
    return any(c.dep_ in ("dobj", "obj") and c.lower_ == "you" for c in tok.children)


def _action_verb(tok: Token) -> Token | None:
    """The verb of a required action headed at `tok`, if there is one.

    Covers imperatives, "please" clauses, "you must / should", "you need to /
    have to", and "you are required / asked / expected to" with their active
    forms ("The council asks you to"). Passive and active give the same
    action, so a P4 rewrite keeps P1 passing.
    """
    children = list(tok.children)
    if tok.tag_ == "VB":
        no_subject = not any(c.dep_ in _SUBJECT_DEPS for c in children)
        only_do = all(c.lower_ == "do" for c in children if c.dep_ == "aux")
        # A heading question ("Need help with council tax?") has the shape of
        # an imperative but asks nothing of the reader.
        question = tok.sent.text.rstrip().endswith("?")
        # A noun phrase heading the small model tags as a verb ("Council Tax
        # reminder notice"): words that modify it come before it.
        heading = any(c.dep_ == "compound" and c.i < tok.i for c in children)
        if tok.dep_ == "ROOT" and no_subject and only_do and not question and not heading:
            return tok
        if any(c.lower_ == "please" for c in children):
            return tok
        if _has_you_subject(tok) and any(
            c.dep_ == "aux" and c.lower_ in ("must", "should") for c in children
        ):
            return tok
    if tok.lemma_.lower() in ("need", "have") and _has_you_subject(tok):
        # "so you don't have to pay" says there is no duty.
        if any(c.dep_ == "neg" for c in tok.children):
            return None
        return _xcomp_verb(tok)
    if tok.lemma_.lower() in ("require", "ask", "expect") and (
        _has_you_subject(tok, ("nsubjpass",)) or _has_you_object(tok)
    ):
        return _xcomp_verb(tok)
    if tok.lemma_.lower() in ("require", "ask", "expect"):
        # "The council expects you to sign": the small model often parses
        # "you to sign" as a ccomp with "you" as its subject.
        return next(
            (
                c
                for c in tok.children
                if c.dep_ == "ccomp"
                and c.tag_ == "VB"
                and _has_you_subject(c)
                and any(g.dep_ == "aux" and g.lower_ == "to" for g in c.children)
            ),
            None,
        )
    return None


def _conj_verbs(verb: Token) -> list[Token]:
    """Verbs joined to `verb` by "and"/"or" that share its subject.

    A joined verb whose object is "you" is skipped: the reader is not the one
    doing it. spaCy often attaches the sender's action to the reader's ("ask
    you to pay all you owe, or even take you to court").
    """
    found: list[Token] = []
    for c in verb.children:
        if (
            c.dep_ == "conj"
            and c.pos_ == "VERB"
            and not any(g.dep_ in _SUBJECT_DEPS for g in c.children)
            and not _has_you_object(c)
        ):
            found.append(c)
            found.extend(_conj_verbs(c))
    return found


def _is_spaced_dash(token: Token) -> bool:
    return (
        token.text in _DASHES
        and token.i > 0
        and bool(token.doc[token.i - 1].whitespace_)
        and bool(token.whitespace_)
    )


def _dash_after(verb: Token) -> int | None:
    """Index of the dash after `verb` that starts a trailing note, or None.

    In "Please pay online now – details on the back." spaCy parses the noun
    after the dash as the verb's object, so the action must stop at the dash.
    Only a spaced dash with no other spaced dash after it counts: a pair of
    dashes holds an aside inside the action ("send - by 1 April 2026 - the
    form"), and a hyphen in "0300-123-4567" is not a break.
    """
    dash = next(
        (c for c in verb.children if c.dep_ == "punct" and c.i > verb.i and _is_spaced_dash(c)),
        None,
    )
    if dash is None:
        return None
    if any(_is_spaced_dash(t) for t in dash.doc[dash.i + 1 :]):
        return None
    return dash.i


def _action_span(verb: Token) -> tuple[int, int]:
    """Character span of the action clause, without joined verbs or "if" clauses.

    The span stops at a trailing-note dash and where a joined verb clause
    starts ("and you must pay ..."). spaCy sometimes hangs words after that
    clause, such as a date, on the first verb or on their own root. They
    belong to the joined verb, so a joined verb's span runs to the next joined
    clause, the next "because"/"if" clause of the first verb, or the end of
    the sentence.
    """
    excluded: set[int] = set()
    joined_verb = any(c.dep_ == "conj" and c.pos_ in ("VERB", "AUX") for c in verb.children)
    cut = _dash_after(verb)
    for c in verb.children:
        # spaCy sometimes tags an amount ("84,811.60") as a verb heading an
        # "advcl". A number never starts a clause, so it stays in the action.
        if c.dep_ == "advcl" and c.like_num:
            continue
        if c.dep_ in ("conj", "cc", "advcl") or (c.dep_ == "punct" and c.i > verb.i):
            excluded.update(t.i for t in c.subtree)
        if joined_verb and c.dep_ in ("conj", "cc") and c.i > verb.i:
            cut = c.left_edge.i if cut is None else min(cut, c.left_edge.i)
    tokens = [
        t
        for t in verb.subtree
        if t.i not in excluded and not t.is_punct and (cut is None or t.i < cut)
    ]
    if verb.dep_ == "conj" and verb.pos_ in ("VERB", "AUX"):
        later = [
            c.left_edge.i
            for c in verb.head.children
            if c.dep_ in ("conj", "cc", "advcl", "mark") and c.i > verb.right_edge.i
        ]
        # Each doc holds 1 checker sentence, so the doc end is the sentence end.
        stop = min(later) if later else len(verb.doc)
        tokens += [
            t for t in verb.doc[verb.right_edge.i + 1 : stop] if not t.is_punct
        ]
    tokens = tokens or [verb]
    return tokens[0].idx, tokens[-1].idx + len(tokens[-1])


def _strip_articles(phrase: str) -> str:
    return " ".join(w for w in phrase.split() if w not in ("a", "an", "the"))


# Keys without articles: "make a payment" is looked up as "make payment", the
# verb lemma followed by its object lemma.
_SYNONYMS = {_strip_articles(word): target for word, target in ACTION_SYNONYMS.items()}


def _apply_synonyms(phrase: str, objects: list[str]) -> tuple[str, list[str]]:
    """Swap a verb phrase for its ACTION_SYNONYMS target.

    A "verb object" entry ("make a payment") is tried first and uses up the
    object, so "Make a payment" and "Pay" give the same action. Swaps don't
    chain.
    """
    for obj in objects:
        target = _SYNONYMS.get(f"{phrase} {obj}")
        if target is not None:
            return target, [o for o in objects if o != obj]
    return _SYNONYMS.get(phrase, phrase), objects


def action_candidates(docs: list[tuple[int, Doc]], facts: list[Candidate]) -> list[Candidate]:
    out: list[Candidate] = []
    for offset, doc in docs:
        verbs: dict[int, Token] = {}
        for tok in doc:
            verb = _action_verb(tok)
            if verb is not None:
                for v in [verb, *_conj_verbs(verb)]:
                    verbs.setdefault(v.i, v)
        for verb in sorted(verbs.values(), key=lambda v: v.i):
            lemma = verb.lemma_.lower()
            # Not a word: text glued together in a PDF ("example.gov.ukmake").
            if lemma in NON_ACTION_VERBS or not lemma.replace("-", "").isalpha():
                continue
            # "fill in" (prt) and "send it back" (back is often parsed as advmod)
            particles = [
                c.lower_
                for c in verb.children
                if c.dep_ == "prt" or (c.dep_ == "advmod" and c.lower_ in _PARTICLES and c.i > verb.i)
            ]
            phrase = " ".join([lemma, *particles])

            start, end = _action_span(verb)
            start, end = start + offset, end + offset
            inside = [f for f in facts if f.start >= start and f.end <= end]

            def in_fact(t: Token) -> bool:
                return any(f.start <= offset + t.idx < f.end for f in facts)

            dash = _dash_after(verb)
            objects = [c for c in verb.children if c.dep_ in ("dobj", "obj") and (dash is None or c.i < dash)]
            objects += [g for o in objects for g in o.conjuncts]
            object_lemmas = sorted(
                {o.lemma_.lower() for o in objects if o.pos_ in ("NOUN", "PROPN") and not in_fact(o)}
            )
            phrase, object_lemmas = _apply_synonyms(phrase, object_lemmas)
            if any(c.dep_ == "neg" for c in verb.children):
                phrase = f"not {phrase}"
            fact_values = sorted(
                f"{f.type}={f.normalised}" for f in inside if f.type in _ACTION_FACT_TYPES
            )
            normalised = "|".join([phrase, ",".join(object_lemmas), ",".join(fact_values)])
            out.append(Candidate("action", start, end, normalised, rank=-1))
    return out


# A bullet list the sender offers ("We could:" then "• Change your payment
# plan."). Its imperatives say what the sender may do, not what the reader must.
_OFFER_LEAD_IN = re.compile(
    r"(?i)(?:\b(?:we|the council|the team|they)\s+(?:could|can|may|might|would)\s*:"
    r"|\byou\s+(?:can|may|could|might)\b[^:\n]*:"
    # "It's easy to sort out your account online:" (the colon may be missing
    # when the line ends on a web address).
    r"|\b(?:it['\u2019]s|it is)\s+(?:easy|simple|quick)\s+to\b[^:\n]*:?)\s*$"
)
_BULLET_LINE = re.compile(r"^\s*[\u2022\u25cf\u25aa*\-\u2013]\s")


def in_offer_list(text: str, start: int) -> bool:
    """Whether `start` is in a bullet whose list opens with an offer lead-in."""
    line_start = text.rfind("\n", 0, start) + 1
    if not _BULLET_LINE.match(text[line_start : line_start + 4]):
        return False
    lines = text[:line_start].rstrip("\n").split("\n")
    for prev in reversed(lines):
        if not prev.strip():
            return False
        if _BULLET_LINE.match(prev):
            continue
        return _OFFER_LEAD_IN.search(prev) is not None
    return False
