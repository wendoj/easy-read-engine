"""P3: one idea per sentence.

Each line is parsed with spaCy, and each of its sentences may have no more
than `MAX_CLAUSES_PER_SENTENCE` main verb clauses. A line may hold more than
one sentence; it fails if any of them has too many clauses.

What counts as a main verb clause:
- the sentence's `ROOT`
- each verb (`VERB` or `AUX`) with the label `conj` whose head is the root:
  "pay £45 **and send** the form", "we got your form **and** we **will reply**"
- each `ccomp` or `advcl` head that has its own subject: "**if** you
  **cannot pay**", "**because** your bill **is** wrong", "the letter says you
  **must pay**"

A `ccomp` or `advcl` with no subject of its own is not counted. These are
mostly "to" clauses that finish the main idea ("the money you pay **to live**
in your home"), and counting them would fail plain one-idea sentences.

Known limit: the small model sometimes tags a sentence-initial verb as a noun
("Phone the council ..."). The root still counts as 1 clause, so this only
matters when a later clause is also mislabelled.

This module never logs, and `details` hold line IDs and counts, never text (R7.4).
"""

from spacy.tokens import Span

from checks.config import MAX_CLAUSES_PER_SENTENCE
from checks.models import CheckResult, KeyFact, Line
from checks.sentences import get_nlp

_VERB_POS = frozenset({"VERB", "AUX"})
_CLAUSE_DEPS = frozenset({"ccomp", "advcl"})
_SUBJECT_DEPS = frozenset({"nsubj", "nsubjpass", "csubj", "csubjpass", "expl"})


def count_clauses(sent: Span) -> int:
    """Number of main verb clauses in one parsed sentence, as defined above."""
    root = sent.root
    count = 1
    for token in sent:
        if token.dep_ == "conj" and token.head == root and token.pos_ in _VERB_POS:
            count += 1
        elif token.dep_ in _CLAUSE_DEPS and any(c.dep_ in _SUBJECT_DEPS for c in token.children):
            count += 1
    return count


def check_p3(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    """Fail every line with a sentence of more than `MAX_CLAUSES_PER_SENTENCE` clauses.

    `original` and `key_facts` are unused. They are kept so every checker has
    the same signature.
    """
    del original, key_facts
    failing: list[str] = []
    details: list[str] = []
    docs = get_nlp().pipe(line.text for line in lines)
    for line, doc in zip(lines, docs):
        most = max((count_clauses(s) for s in doc.sents), default=0)
        if most > MAX_CLAUSES_PER_SENTENCE:
            failing.append(line.id)
            details.append(
                f"{line.id} has a sentence with {most} main clauses (limit {MAX_CLAUSES_PER_SENTENCE})"
            )
    return CheckResult(
        rule="P3",
        passed=not failing,
        line_ids=failing,
        failed_fact_ids=[],
        details=details,
    )
