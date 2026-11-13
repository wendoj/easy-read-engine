"""Models shared by the checkers and both adapters.

Class docstrings appear in the OpenAPI schema, and the web app's TypeScript
types are generated from it, so editing them changes `web/src/types/checker.ts`.
"""

from typing import Literal

from pydantic import BaseModel

KeyFactType = Literal["date", "time", "money", "reference", "phone", "address", "action"]
Rule = Literal["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]


class Sentence(BaseModel):
    id: str
    text: str
    start: int  # character offset in the Original
    end: int  # exclusive, so original[start:end] == text


class KeyFact(BaseModel):
    id: str
    type: KeyFactType
    value: str  # raw text as it appears
    normalised: str  # used by P1
    start: int
    end: int
    sentence_id: str


class Line(BaseModel):
    id: str
    text: str
    source_sentence_id: str
    symbol_id: str | None


class Analysis(BaseModel):
    """What `analyse` returns: the Original's sentences and its key facts."""

    sentences: list[Sentence]
    key_facts: list[KeyFact]


class SymbolMatch(BaseModel):
    """One `find_symbol` result: a pictogram ID from the symbol index and its rank score."""

    id: str
    score: float


class ActionSynonym(BaseModel):
    """One entry of the P1 action synonym table: a verb that P1 treats as `counts_as`."""

    word: str
    counts_as: str


class LineFactSpan(BaseModel):
    """Where a key fact from the Original appears in one output line, for
    highlighting (R5.3). `start` and `end` are offsets into the line's text.
    Holds IDs and offsets only, never the value."""

    line_id: str
    fact_id: str
    start: int
    end: int  # exclusive, so line.text[start:end] is the fact's text


class CheckResult(BaseModel):
    rule: Rule
    passed: bool
    line_ids: list[str]  # lines the rule applied to or failed on
    failed_fact_ids: list[str]  # P1 only
    details: list[str]  # short reasons, for the report
