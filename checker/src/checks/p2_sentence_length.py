"""P2: no sentence in a line has more than `MAX_SENTENCE_WORDS` words.

A word is a whitespace-separated run holding a letter or digit, as a reader
sees it, not a spaCy token: "£1,234.56", "don't" and "(PIP)" are 1 word each,
and "0300 123 4567" is 3.
"""

from checks.config import MAX_SENTENCE_WORDS
from checks.models import CheckResult, KeyFact, Line
from checks.results import line_result
from checks.sentences import split_sentences


def count_words(text: str) -> int:
    return sum(1 for part in text.split() if any(c.isalnum() for c in part))


def check_p2(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    del original, key_facts
    failing: list[str] = []
    details: list[str] = []
    for line in lines:
        longest = max((count_words(s.text) for s in split_sentences(line.text)), default=0)
        if longest > MAX_SENTENCE_WORDS:
            failing.append(line.id)
            details.append(
                f"{line.id} has a sentence of {longest} words (limit {MAX_SENTENCE_WORDS})"
            )
    return line_result("P2", failing, details)
