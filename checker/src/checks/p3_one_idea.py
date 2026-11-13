"""P3: one idea per sentence (at most `MAX_CLAUSES_PER_SENTENCE` main clauses).

Main clauses are the root, each `conj` verb on the root ("pay £45 and send
the form"), and each `ccomp` or `advcl` with its own subject ("if you cannot
pay"). These are not counted, because they finish the main idea (found on the
recorded sample letters, where they failed plain one-idea lines):
- "to" verbs, even when the parse gives them a subject ("expects you to sign")
- the first `ccomp` of a reporting verb whose subject is a noun or "it" ("The
  letter says you must pay"). Verbs joined to it and any `advcl` still count
- embedded questions and "what" clauses ("pay what you owe"). An "if" clause
  is a question only straight after a `QUESTION_VERBS` verb with no object
  and no negation ("Check if you're due", not "Tell us if you move")
- the clause after "let", "make", "help", "see" or "hear" ("Let us know.")
- a "that" clause after "it is ..." ("It is essential that you contact us.")
- the clause after a thinking verb with no subject ("Think you'll miss more
  payments?"). "You think you must pay" still counts 2
- "like" or "as if" after "look", "seem", "sound" or "feel"

Known limit: the small model sometimes tags a sentence-initial verb as a noun
("Phone the council ..."). The root still counts as 1 clause.
"""

from spacy.tokens import Span, Token

from checks.config import MAX_CLAUSES_PER_SENTENCE, REPORTING_VERBS
from checks.models import CheckResult, KeyFact, Line
from checks.results import line_result
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
# Verbs that take an "if" question: "Check if ...", "Find out if ...". Not
# "know": "Let us know if you move." is a condition, and "Let us know whether
# ..." is still a question through "whether".
QUESTION_VERBS = frozenset({"check", "see", "find", "ask", "wonder"})


def _is_reporting(root: Token) -> bool:
    if root.lemma_.lower() not in REPORTING_VERBS:
        return False
    return any(
        c.dep_ == "nsubj" and (c.pos_ in _NOUN_POS or c.lower_ == "it") for c in root.children
    )


def _is_infinitive(verb: Token) -> bool:
    return verb.tag_ == "VB" and any(c.dep_ == "aux" and c.lower_ == "to" for c in verb.children)


def _is_question_after(head: Token, clause: Token) -> bool:
    """Whether an "if"/"whether" clause is the question a verb like "check" asks.

    The parse may tag it `advcl` ("Check if you're due benefits.") or `ccomp`
    ("see if you are entitled"), so both are handled here.
    """
    if head.lemma_.lower() not in QUESTION_VERBS:
        return False
    if any(c.dep_ in ("dobj", "obj") for c in head.children):
        return False
    mark = next((c for c in clause.children if c.dep_ == "mark" and c.lower_ in _QUESTION_MARKS), None)
    if mark is None:
        return False
    # A negated "if" clause is a condition: "Find out if you cannot pay."
    if mark.lower_ == "if" and any(c.dep_ == "neg" for c in clause.children):
        return False
    between = head.doc[head.i + 1 : mark.i]
    return all(t.dep_ == "prt" and t.head == head for t in between)


def _finishes_main_idea(clause: Token) -> bool:
    head = clause.head
    marks = {c.lower_ for c in clause.children if c.dep_ == "mark"}
    if clause.dep_ == "advcl":
        if head.lemma_.lower() in _SEEM_VERBS and bool(marks & {"like", "as"}):
            return True
        return _is_question_after(head, clause)
    if "whether" in marks:
        return True
    if "if" in marks:
        return _is_question_after(head, clause)
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
    return line_result("P3", failing, details)
