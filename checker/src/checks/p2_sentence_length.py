"""P2: no sentence in a line is longer than `MAX_SENTENCE_WORDS` words.

Each line is split into sentences with the same splitter as the Original
(`split_sentences`), so a line may hold more than one sentence. A line fails
if any of its sentences is over the limit.

How words are counted. A word is a run of characters between whitespace that
holds at least one letter or digit. Punctuation and symbols on their own
("-", "/", "&") are not words. This counts words the way a reader sees them
on the page, rather than spaCy tokens, which split "£45" and "don't" in two:

- "£45", "£1,234.56", "10:30am", "14:30", "AB123456" and "02/03/2026" are 1 word each
- "don't", "self-employed" and "(PIP)" are 1 word each
- "14 March 2026" is 3 words, "0300 123 4567" is 3 words, "LS1 4AB" is 2 words

So a phone number or date counts as the number of parts it is printed in.

This module never logs, and `details` hold line IDs and counts, never text (R7.4).
"""

from checks.config import MAX_SENTENCE_WORDS
from checks.models import CheckResult, KeyFact, Line
from checks.sentences import split_sentences


def count_words(text: str) -> int:
    """Number of words in `text`, as defined in the module docstring."""
    return sum(1 for part in text.split() if any(c.isalnum() for c in part))


def check_p2(original: str, key_facts: list[KeyFact], lines: list[Line]) -> CheckResult:
    """Fail every line that has a sentence of more than `MAX_SENTENCE_WORDS` words.

    `original` and `key_facts` are unused. They are kept so every checker has
    the same signature.
    """
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
    return CheckResult(
        rule="P2",
        passed=not failing,
        line_ids=failing,
        failed_fact_ids=[],
        details=details,
    )
