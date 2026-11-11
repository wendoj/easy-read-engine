"""Pure checker functions shared by the HTTP and MCP adapters (design "Checker service").

The adapters call only the functions below. Nothing here calls a model, logs,
or stores letter text (R7.4).
"""

from collections.abc import Callable

from checks import key_facts as _key_facts
from checks.models import Analysis, CheckResult, KeyFact, Line, Rule, SymbolMatch
from checks.p1_key_facts import check_p1
from checks.p2_sentence_length import check_p2
from checks.p3_one_idea import check_p3
from checks.p4_passive import check_p4
from checks.p5_plain_words import check_p5
from checks.p6_digits import check_p6
from checks.p7_abbreviations import check_p7
from checks.p8_symbols import check_p8
from checks.sentences import split_sentences

__all__ = ["CHECKERS", "analyse", "check_easy_read", "extract_key_facts", "find_symbol"]

Checker = Callable[[str, list[KeyFact], list[Line]], CheckResult]

# P1 to P8 in rule order. `check_easy_read` returns results in this order.
CHECKERS: tuple[tuple[Rule, Checker], ...] = (
    ("P1", check_p1),
    ("P2", check_p2),
    ("P3", check_p3),
    ("P4", check_p4),
    ("P5", check_p5),
    ("P6", check_p6),
    ("P7", check_p7),
    ("P8", check_p8),
)


def analyse(original: str) -> Analysis:
    """Split the Original into sentences and extract its key facts.

    Each key fact's `sentence_id` refers to one of the returned sentences.
    """
    sentences = split_sentences(original)
    return Analysis(sentences=sentences, key_facts=_key_facts.extract_key_facts(original, sentences))


def extract_key_facts(text: str) -> list[KeyFact]:
    """Key facts in `text`, with spans and normalised values (design "Key-fact extraction")."""
    return _key_facts.extract_key_facts(text)


def check_easy_read(original: str, key_facts: list[KeyFact], lines: list[Line]) -> list[CheckResult]:
    """Run P1 to P8 and return exactly one result per rule, in rule order.

    `key_facts` must come from the Original (`analyse` or `extract_key_facts`),
    never from the output, so P1 compares the output with the Original.
    """
    results = []
    for rule, checker in CHECKERS:
        result = checker(original, key_facts, lines)
        if result.rule != rule:
            raise RuntimeError(f"checker for {rule} returned a result for {result.rule}")
        results.append(result)
    return results


def find_symbol(query: str, limit: int = 5) -> list[SymbolMatch]:
    """Pictograms for `query`, best first, at most `limit`.

    Stub until task 23: it returns no matches, so every line gets
    `symbol_id: None` and no picture (R4.2).
    """
    del query, limit
    return []
