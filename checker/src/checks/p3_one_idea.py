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
in your home"), and counting them would fail plain one-idea sentences. A "to"
verb is not counted even when the parse gives it a subject ("The council
expects **you to sign** the form").

A `ccomp` after a reporting verb (`REPORTING_VERBS`: "say", "tell", ...) is not
counted either when the root's subject is a noun ("the letter", "the
council") or "it". "The letter says you must pay £45." is one idea: what the
letter says. Verbs joined to that `ccomp` by "and" still count, and so does
any `advcl`, so "The letter says you must pay because you missed a payment."
still fails.

Clauses that finish the main idea are not counted either (found on the
recorded sample letters, where they failed plain one-idea lines):

- an embedded question or "what" clause: "see **if you are entitled**",
  "pay **what you owe**", "discuss **how evidence will be heard**". The
  parse tags "Check **if you're due** benefits." as `advcl`; that counts as
  a question only when "if" comes straight after a `QUESTION_VERBS` verb
  with no object ("Check your bill if you moved." still counts 2)
- the clause after "let", "make", "help", "see" or "hear": "**Let us know.**",
  "Rule 6 status **lets you present** evidence."
- a "that" clause after "it is ...": "**It is essential that you contact** us."
- the clause after a thinking verb (`THINKING_VERBS`) with no subject of
  its own: "**Think you'll miss** more payments?" ("You think you must pay"
  still counts: the reader thinking it is a second idea.)
- "like" or "as if" after "look", "seem", "sound" or "feel": "**It looks like
  you missed** a payment."

An "if", "because", "so" or "when" clause still counts, as the rule asks.

Known limit: the small model sometimes tags a sentence-initial verb as a noun
("Phone the council ..."). The root still counts as 1 clause, so this only
matters when a later clause is also mislabelled.

This module never logs, and `details` hold line IDs and counts, never text (R7.4).
"""

from spacy.tokens import Span, Token

from checks.config import MAX_CLAUSES_PER_SENTENCE, REPORTING_VERBS
from checks.models import CheckResult, KeyFact, Line
from checks.sentences import get_nlp

_VERB_POS = frozenset({"VERB", "AUX"})
_CLAUSE_DEPS = frozenset({"ccomp", "advcl"})
_SUBJECT_DEPS = frozenset({"nsubj", "nsubjpass", "csubj", "csubjpass", "expl"})
_NOUN_POS = frozenset({"NOUN", "PROPN"})
_WH_WORDS = frozenset({"what", "how", "when", "where", "why", "who", "whom", "which", "whether"})
_QUESTION_MARKS = frozenset({"if", "whether"})
_CAUSATIVE = frozenset({"let", "make", "help", "see", "hear", "watch"})
THINKING_VERBS = frozenset({"think", "know", "feel", "believe", "hope", "worry", "wonder", "guess"})
_SEEM_VERBS = frozenset({"look", "seem", "sound", "feel"})
# Verbs that take an "if" question: "Check if ...", "Find out if ...".
QUESTION_VERBS = frozenset({"check", "see", "find", "ask", "know", "wonder"})


def _is_reporting(root: Token) -> bool:
    """Whether `root` is a reporting verb whose subject is a noun or "it"."""
    if root.lemma_.lower() not in REPORTING_VERBS:
        return False
    return any(
        c.dep_ == "nsubj" and (c.pos_ in _NOUN_POS or c.lower_ == "it") for c in root.children
    )


def _is_infinitive(verb: Token) -> bool:
    """A "to" verb such as "sign" in "The council expects you to sign the form".

    The small model sometimes gives such a verb "you" as its own subject, but
    it finishes the main idea, so it is not counted as a clause.
    """
    return verb.tag_ == "VB" and any(c.dep_ == "aux" and c.lower_ == "to" for c in verb.children)


def _is_question_after(head: Token, clause: Token) -> bool:
    """Whether an `advcl` is the "if" question a verb like "check" asks.

    The parse tags "Check **if you're due** benefits." and "Find out **if you
    can** get help." as `advcl`, not `ccomp`. It is a question, not a condition,
    only when "if" or "whether" comes straight after a `QUESTION_VERBS` verb
    (or its "out") and that verb has no object of its own. "Check your bill if
    you moved." and "If you moved, check your bill." still count 2 clauses.
    """
    if head.lemma_.lower() not in QUESTION_VERBS:
        return False
    if any(c.dep_ in ("dobj", "obj") for c in head.children):
        return False
    mark = next((c for c in clause.children if c.dep_ == "mark" and c.lower_ in _QUESTION_MARKS), None)
    if mark is None:
        return False
    between = head.doc[head.i + 1 : mark.i]
    return all(t.dep_ == "prt" and t.head == head for t in between)


def _finishes_main_idea(clause: Token) -> bool:
    """Whether a subject-bearing `ccomp` or `advcl` is part of its head's idea (see above)."""
    head = clause.head
    marks = {c.lower_ for c in clause.children if c.dep_ == "mark"}
    if clause.dep_ == "advcl":
        if head.lemma_.lower() in _SEEM_VERBS and bool(marks & {"like", "as"}):
            return True
        return _is_question_after(head, clause)
    if marks & _QUESTION_MARKS:
        return True
    first = clause.left_edge
    if first.lower_ in _WH_WORDS and first.i < clause.i:
        return True
    lemma = head.lemma_.lower()
    if lemma in _CAUSATIVE:
        return True
    if lemma in THINKING_VERBS and not any(c.dep_ in _SUBJECT_DEPS for c in head.children):
        return True
    extraposed = any(c.dep_ in ("nsubj", "expl") and c.lower_ == "it" for c in head.children)
    return extraposed and "that" in marks


def count_clauses(sent: Span) -> int:
    """Number of main verb clauses in one parsed sentence, as defined above."""
    root = sent.root
    reporting = _is_reporting(root)
    reported = None
    count = 1
    for token in sent:
        if token.dep_ == "conj" and token.head == root and token.pos_ in _VERB_POS:
            count += 1
        elif token.dep_ in _CLAUSE_DEPS and any(c.dep_ in _SUBJECT_DEPS for c in token.children):
            if _is_infinitive(token) or _finishes_main_idea(token):
                continue
            if reporting and reported is None and token.dep_ == "ccomp" and token.head == root:
                reported = token
            else:
                count += 1
    if reported is not None:
        count += sum(
            1 for t in reported.children if t.dep_ == "conj" and t.pos_ in _VERB_POS
        )
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
