"""P4: no line uses the passive voice.

A line fails if spaCy's dependency parse gives any token the label `auxpass`
(a passive auxiliary, "was" in "The form was sent") or `nsubjpass` (a passive
subject, "form" in the same sentence).

Known limit: with no "by ..." agent, the small model sometimes reads a past
participle as an adjective ("Your account was closed.") and the line passes.

This module never logs, and `details` hold line IDs, never text (R7.4).
"""

from checks.models import CheckResult, KeyFact, Line
from checks.sentences import get_nlp

PASSIVE_DEPS = frozenset({"auxpass", "nsubjpass"})


def check_p4(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    """Fail every line with an `auxpass` or `nsubjpass` dependency.

    `original` and `key_facts` are unused. They are kept so every checker has
    the same signature.
    """
    del original, key_facts
    failing: list[str] = []
    details: list[str] = []
    docs = get_nlp().pipe(line.text for line in lines)
    for line, doc in zip(lines, docs):
        if any(token.dep_ in PASSIVE_DEPS for token in doc):
            failing.append(line.id)
            details.append(f"{line.id} uses the passive voice")
    return CheckResult(
        rule="P4",
        passed=not failing,
        line_ids=failing,
        failed_fact_ids=[],
        details=details,
    )
