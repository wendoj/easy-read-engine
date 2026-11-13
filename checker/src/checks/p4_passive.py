"""P4: no line uses the passive voice (an `auxpass` or `nsubjpass` dependency).

Statal passives pass: a `STATAL_PARTICIPLES` verb with "you" as subject, a
following "to" and no "by ..." agent ("You are entitled to Housing Benefit.").

Known limit: with no agent, the small model sometimes reads a past participle
as an adjective ("Your account was closed.") and the line passes.
"""

from spacy.tokens import Token

from checks.config import STATAL_PARTICIPLES
from checks.models import CheckResult, KeyFact, Line
from checks.results import line_result
from checks.sentences import get_nlp

PASSIVE_DEPS = frozenset({"auxpass", "nsubjpass"})


def _is_statal(verb: Token) -> bool:
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
    del original, key_facts
    failing: list[str] = []
    details: list[str] = []
    docs = get_nlp().pipe(line.text for line in lines)
    for line, doc in zip(lines, docs):
        if any(_is_passive(token) for token in doc):
            failing.append(line.id)
            details.append(f"{line.id} uses the passive voice")
    return line_result("P4", failing, details)
