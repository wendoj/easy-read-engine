"""P4: no line uses the passive voice.

A line fails if spaCy's dependency parse gives any token the label `auxpass`
(a passive auxiliary, "was" in "The form was sent") or `nsubjpass` (a passive
subject, "form" in the same sentence).

Statal passives are allowed: "You are entitled to Housing Benefit." and "You
are required to pay." describe the reader's state, and have no plain active
form. A passive passes when its verb is in `STATAL_PARTICIPLES`, its subject is
"you", a "to" follows (a "to" phrase or a "to" verb), and it has no "by ..."
agent. "A letter will be sent to you." and "The form was sent." still fail.

Known limit: with no "by ..." agent, the small model sometimes reads a past
participle as an adjective ("Your account was closed.") and the line passes.

This module never logs, and `details` hold line IDs, never text (R7.4).
"""

from spacy.tokens import Token

from checks.config import STATAL_PARTICIPLES
from checks.models import CheckResult, KeyFact, Line
from checks.sentences import get_nlp

PASSIVE_DEPS = frozenset({"auxpass", "nsubjpass"})


def _is_statal(verb: Token) -> bool:
    """Whether `verb` is an allowed statal passive ("you are entitled to ...")."""
    if verb.lemma_.lower() not in STATAL_PARTICIPLES:
        return False
    children = list(verb.children)
    you_subject = any(c.dep_ == "nsubjpass" and c.lower_ == "you" for c in children)
    has_agent = any(c.dep_ == "agent" for c in children)
    to_follows = any(
        c.i > verb.i
        and (
            (c.dep_ == "prep" and c.lower_ == "to")
            or (c.dep_ == "xcomp" and any(g.dep_ == "aux" and g.lower_ == "to" for g in c.children))
        )
        for c in children
    )
    return you_subject and to_follows and not has_agent


def _is_passive(token: Token) -> bool:
    return token.dep_ in PASSIVE_DEPS and not _is_statal(token.head)


def check_p4(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    """Fail every line with an `auxpass` or `nsubjpass` dependency, except statal passives.

    `original` and `key_facts` are unused. They are kept so every checker has
    the same signature.
    """
    del original, key_facts
    failing: list[str] = []
    details: list[str] = []
    docs = get_nlp().pipe(line.text for line in lines)
    for line, doc in zip(lines, docs):
        if any(_is_passive(token) for token in doc):
            failing.append(line.id)
            details.append(f"{line.id} uses the passive voice")
    return CheckResult(
        rule="P4",
        passed=not failing,
        line_ids=failing,
        failed_fact_ids=[],
        details=details,
    )
