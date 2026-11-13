"""Regex detectors and normalisers for key facts other than required actions."""

import re
from dataclasses import dataclass
from decimal import Decimal

from checks.models import KeyFactType

# Horizontal whitespace: facts never run across a line break.
_H = r"[^\S\n]"

_MONTH = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?"
    r"|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_MONTH_NUMBER = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}  # fmt: skip
# Lower-case month names that are usually ordinary words ("section 3 may apply").
_LOWERCASE_NON_MONTHS = frozenset({"may", "mar"})
_WEEKDAY = (
    r"(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday"
    r"|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)"
)
_WEEKDAY_PREFIX = rf"(?:{_WEEKDAY},?{_H}+)?"
_DAY = r"(?P<d>[0-3]?\d)(?:st|nd|rd|th)?"

# "Monday-Friday", "Monday – Friday" and "Monday to Friday" normalise the same,
# so a rewrite from one form to another still matches.
_DATE_WEEKDAY_RANGE = re.compile(
    rf"(?i)\b(?P<a>{_WEEKDAY})(?:{_H}*[-\u2010-\u2015]{_H}*|{_H}+(?:to|until|through|till){_H}+)(?P<b>{_WEEKDAY})\b"
)

# "Monday 1 March 2026", "1st of March", "the 1st March 2026"
_DATE_DMY = re.compile(
    rf"(?i)\b{_WEEKDAY_PREFIX}(?:the{_H}+)?{_DAY}(?:{_H}+of)?{_H}+(?P<m>{_MONTH})\b"
    rf"(?:,?{_H}+(?P<y>\d{{4}})\b)?"
)
# "March 1, 2026". The year is required, so "March 3 people" is not a date.
_DATE_MDY = re.compile(
    rf"(?i)\b{_WEEKDAY_PREFIX}(?P<m>{_MONTH}){_H}+{_DAY}\b,?{_H}+(?P<y>\d{{4}})\b"
)
_DATE_MY = re.compile(rf"(?i)\b(?P<m>{_MONTH}){_H}+(?P<y>\d{{4}})\b")
# "1/3/2026", "01.03.26", "1-3-2026", in UK order (day first).
_DATE_NUMERIC = re.compile(
    r"(?<![\w/.\-])(?P<d>[0-3]?\d)(?P<sep>[/.\-])(?P<m>[01]?\d)(?P=sep)(?P<y>\d{4}|\d{2})"
    r"(?![\w/\-]|\.\d)"
)
_DATE_ISO = re.compile(
    r"(?<![\w/.\-])(?P<y>\d{4})-(?P<m>[01]\d)-(?P<d>[0-3]\d)(?![\w/\-]|\.\d)"
)

_UNIT_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
}  # fmt: skip
_TENS_WORDS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}  # fmt: skip


def _alternation(words: list[str]) -> str:
    return "|".join(sorted(words, key=len, reverse=True))


_NUMBER_WORD = (
    rf"(?:(?:{_alternation(list(_TENS_WORDS))})"
    rf"(?:(?:-|{_H})(?:{_alternation([w for w, n in _UNIT_WORDS.items() if 1 <= n <= 9])}))?"
    rf"|{_alternation(list(_UNIT_WORDS))})"
)
# "within 14 days", "28 working days", "fourteen days", "2 weeks"
_DATE_RELATIVE = re.compile(
    rf"(?i)\b(?:(?:within|in|after|for){_H}+)?(?P<n>\d+|{_NUMBER_WORD})(?:{_H}+|-)"
    rf"(?:(?P<q>working|calendar|business|clear){_H}+)?(?P<u>day|week|month|year)s?\b"
)

# "9am", "9.30 am", "2:30pm", "9 a.m."
_TIME_12 = re.compile(
    rf"(?i)\b(?P<h>1[0-2]|0?[1-9])(?:[:.](?P<mi>[0-5]\d))?{_H}*(?P<ap>[ap])\.?m\b"
)
_TIME_24 = re.compile(
    rf"(?<![\d:.])(?P<h>[01]?\d|2[0-3]):(?P<mi>[0-5]\d)(?![\d:]|{_H}*[ap]\.?m\b)", re.I
)
_TIME_NOON = re.compile(rf"(?i)\b(?:12{_H}*)?(?:noon|midday)\b")
_TIME_MIDNIGHT = re.compile(rf"(?i)\b(?:12{_H}*)?midnight\b")

_AMOUNT = r"(?P<num>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?P<dec>\d{1,2}))?(?!\d|[.,]\d)"
_MULTIPLIER = rf"(?:{_H}*(?P<mult>million|billion|thousand)\b)?"
_MONEY_SYMBOL = re.compile(rf"(?P<cur>[£$€]){_H}?{_AMOUNT}{_MULTIPLIER}", re.I)
_MONEY_CODE = re.compile(rf"\b(?P<cur>GBP|USD|EUR){_H}?{_AMOUNT}{_MULTIPLIER}")
_MONEY_WORD = re.compile(
    rf"(?<![\w£$€.,]){_AMOUNT}{_MULTIPLIER}{_H}*(?P<word>pounds?|pence|p)\b", re.I
)
_CURRENCY = {"£": "GBP", "$": "USD", "€": "EUR", "GBP": "GBP", "USD": "USD", "EUR": "EUR"}
_MULTIPLIERS = {None: 1, "thousand": 10**3, "million": 10**6, "billion": 10**9}

# A keyword, an optional "number"/"no."/"is"/":", then the code. The code's
# first token holds a digit, or is 1 to 4 capitals followed by digits
# ("AB 12 34 56 C"). Later tokens are trimmed in `_reference_end`.
_REFERENCE = re.compile(
    r"(?i:\b(?:reference|ref|claim|account|case|customer|application|invoice|booking"
    rf"|tenancy|policy|membership|nhs|ni|national{_H}+insurance|sort{_H}+code)\b\.?)"
    rf"(?i:{_H}+(?:number\b|no\b\.?|num\b|ref(?:erence)?\b|id\b|code\b))?"
    rf"(?i:{_H}*(?:is\b|:|#))?{_H}*"
    rf"(?P<code>(?:[A-Za-z0-9/\-]*\d[A-Za-z0-9/\-]*|[A-Z]{{1,4}}(?={_H}\d))"
    rf"(?:{_H}[A-Za-z0-9/\-]+)*)"
)

_PHONE = re.compile(r"(?<![\w+])(?:\+44[ -]?(?:\(0\)[ -]?)?|\(0|0)(?=\d)\d*(?:\)?[ -]?\d+)*")
# Short numbers ("call 111") count only after a calling verb.
_PHONE_SHORT = re.compile(
    rf"(?i:\b(?:call|phone|ring|dial|telephone|tel)\b\.?:?{_H}+(?:us{_H}+)?(?:on{_H}+)?)"
    rf"(?P<n>1\d\d|999)\b(?!{_H}?\d)"
)

_POSTCODE = re.compile(
    rf"(?i)\b(?P<out>[A-Z]{{1,2}}\d[A-Z\d]?){_H}*(?P<in>\d[ABD-HJLNP-UW-Z]{{2}})\b"
)
_STREET_TYPES = (
    "Street|St|Road|Rd|Avenue|Ave|Lane|Close|Drive|Way|Place|Court|Crescent|Gardens"
    "|Square|Terrace|Hill|Grove|Row|Park|Walk|Mews|Parade|Rise|Green"
)
# "10 Downing Street", "3a Mill Lane"
_STREET = re.compile(
    rf"\b\d+[A-Za-z]?,?{_H}+(?:[A-Z][A-Za-z'’\-]*{_H}+){{1,3}}(?:{_STREET_TYPES})\b"
)
# What may sit between the first address line and the postcode: town and
# county names, commas and single line breaks. No digits.
_ADDRESS_GAP = re.compile(r"[A-Za-z'’\-.,\s]*")
_BLANK_LINE = re.compile(r"\n[^\S\n]*\n")
_ADDRESS_WINDOW = 80

HAS_DIGIT = re.compile(r"\d")
DATE_WORD = re.compile(rf"(?i)\b(?:{_MONTH}|{_WEEKDAY})\b")

# Lower rank wins when two candidates overlap; then the longer one.
_RANK_REFERENCE, _RANK_PHONE, _RANK_ADDRESS, _RANK_DATE = 0, 1, 2, 3
_RANK_TIME, _RANK_MONEY, _RANK_STREET, RANK_NER = 4, 5, 6, 7


@dataclass(frozen=True)
class Candidate:
    type: KeyFactType
    start: int
    end: int
    normalised: str
    rank: int


def collapse(text: str) -> str:
    return " ".join(text.split())


def _iso_date(day: str | None, month: int, year: str | None) -> str | None:
    """ISO date, or a partial one ("2026-03", "--03-01") when parts are missing."""
    if not 1 <= month <= 12:
        return None
    if year is not None and len(year) == 2:
        year = f"20{year}"
    if day is None:
        return f"{int(year):04d}-{month:02d}" if year else None
    d = int(day)
    if not 1 <= d <= 31:
        return None
    return f"{int(year):04d}-{month:02d}-{d:02d}" if year else f"--{month:02d}-{d:02d}"


def _month_number(name: str) -> int:
    return _MONTH_NUMBER[name[:3].lower()]


def _parse_number_word(text: str) -> int:
    total = 0
    for part in re.split(r"[-\s]+", text.lower()):
        total += _TENS_WORDS.get(part, 0) + _UNIT_WORDS.get(part, 0)
    return total


def _relative_date(n: str, qualifier: str | None, unit: str) -> str:
    count = int(n) if n.isdigit() else _parse_number_word(n)
    unit = unit.lower() if count == 1 else f"{unit.lower()}s"
    middle = f"{qualifier.lower()} " if qualifier else ""
    return f"{count} {middle}{unit}"


def _pence(num: str, dec: str | None, mult: str | None, in_pence: bool) -> str:
    amount = Decimal(num.replace(",", "") + (f".{dec}" if dec else ""))
    amount *= _MULTIPLIERS[mult.lower() if mult else None]
    pence = amount if in_pence else amount * 100
    if pence == pence.to_integral_value():
        return str(int(pence))
    return format(pence.normalize(), "f")


def _time_12(h: str, mi: str | None, ap: str) -> str:
    hour = int(h) % 12 + (12 if ap.lower() == "p" else 0)
    return f"{hour:02d}:{int(mi or 0):02d}"


def _phone_digits(raw: str) -> tuple[int, str] | None:
    """Longest leading run of digit groups that makes a UK number.

    Returns (end offset within `raw`, digits with +44 turned into 0).
    """
    groups = list(re.finditer(r"\d+", raw))
    international = raw.startswith("+44")
    best: tuple[int, str] | None = None
    digits = ""
    for i, g in enumerate(groups):
        # Drop the country code; "+443001234567" is a single digit group.
        digits += g.group()[2:] if international and i == 0 else g.group()
        if not digits:
            continue
        number = digits if digits.startswith("0") or not international else f"0{digits}"
        if len(number) in (10, 11) and number[0] == "0" and number[1] != "0":
            best = (g.end(), number)
    return best


def _reference_end(code: str) -> int:
    """Length of the reference code, trimming trailing words that aren't part of it."""
    tokens = list(re.finditer(r"\S+", code))
    end = tokens[0].end()
    prev = tokens[0].group()
    for tok in tokens[1:]:
        word = tok.group()
        if HAS_DIGIT.search(word) or (re.fullmatch(r"[A-Z]", word) and prev.isdigit()):
            end, prev = tok.end(), word
        else:
            break
    while end > 0 and code[end - 1] in "/-":
        end -= 1
    return end


def regex_candidates(text: str) -> list[Candidate]:
    out: list[Candidate] = []

    def add(kind: KeyFactType, start: int, end: int, normalised: str | None, rank: int) -> None:
        if normalised is not None and end > start:
            out.append(Candidate(kind, start, end, normalised, rank))

    for m in _REFERENCE.finditer(text):
        code_start = m.start("code")
        code_end = code_start + _reference_end(m.group("code"))
        value = text[code_start:code_end]
        if HAS_DIGIT.search(value) and sum(c.isalnum() for c in value) >= 3:
            add("reference", code_start, code_end, re.sub(r"\s", "", value).upper(),
                _RANK_REFERENCE)  # fmt: skip

    for m in _PHONE.finditer(text):
        found = _phone_digits(m.group())
        if found:
            add("phone", m.start(), m.start() + found[0], found[1], _RANK_PHONE)
    for m in _PHONE_SHORT.finditer(text):
        add("phone", m.start("n"), m.end("n"), m.group("n"), _RANK_PHONE)

    for regex in (_DATE_DMY, _DATE_MDY):
        for m in regex.finditer(text):
            if m.group("m") in _LOWERCASE_NON_MONTHS:
                continue
            add("date", m.start(), m.end(),
                _iso_date(m.group("d"), _month_number(m.group("m")), m.group("y")),
                _RANK_DATE)  # fmt: skip
    for m in _DATE_MY.finditer(text):
        if m.group("m") in _LOWERCASE_NON_MONTHS:
            continue
        add("date", m.start(), m.end(), _iso_date(None, _month_number(m.group("m")), m.group("y")),
            _RANK_DATE)  # fmt: skip
    for regex in (_DATE_NUMERIC, _DATE_ISO):
        for m in regex.finditer(text):
            add("date", m.start(), m.end(),
                _iso_date(m.group("d"), int(m.group("m")), m.group("y")), _RANK_DATE)  # fmt: skip
    for m in _DATE_WEEKDAY_RANGE.finditer(text):
        add("date", m.start(), m.end(), f"{m.group('a')[:3].lower()} to {m.group('b')[:3].lower()}",
            _RANK_DATE)  # fmt: skip
    for m in _DATE_RELATIVE.finditer(text):
        add("date", m.start(), m.end(), _relative_date(m.group("n"), m.group("q"), m.group("u")),
            _RANK_DATE)  # fmt: skip

    for m in _TIME_12.finditer(text):
        add("time", m.start(), m.end(), _time_12(m.group("h"), m.group("mi"), m.group("ap")),
            _RANK_TIME)  # fmt: skip
    for m in _TIME_24.finditer(text):
        add("time", m.start(), m.end(), f"{int(m.group('h')):02d}:{m.group('mi')}", _RANK_TIME)
    for m in _TIME_NOON.finditer(text):
        add("time", m.start(), m.end(), "12:00", _RANK_TIME)
    for m in _TIME_MIDNIGHT.finditer(text):
        add("time", m.start(), m.end(), "00:00", _RANK_TIME)

    for regex in (_MONEY_SYMBOL, _MONEY_CODE):
        for m in regex.finditer(text):
            cur = _CURRENCY[m.group("cur").upper()]
            add("money", m.start(), m.end(),
                f"{cur} {_pence(m.group('num'), m.group('dec'), m.group('mult'), False)}",
                _RANK_MONEY)  # fmt: skip
    for m in _MONEY_WORD.finditer(text):
        in_pence = m.group("word").lower() in ("p", "pence")
        add("money", m.start(), m.end(),
            f"GBP {_pence(m.group('num'), m.group('dec'), m.group('mult'), in_pence)}",
            _RANK_MONEY)  # fmt: skip

    return out


def address_candidates(text: str, facilities: list[tuple[int, int]]) -> list[Candidate]:
    """Postcode plus first address line; street lines alone also count."""
    out: list[Candidate] = []
    streets = [(m.start(), m.end()) for m in _STREET.finditer(text)]
    used: set[tuple[int, int]] = set()

    def line_before(postcode_start: int, spans: list[tuple[int, int]]) -> tuple[int, int] | None:
        for span in sorted(spans, key=lambda s: s[1], reverse=True):
            gap = text[span[1] : postcode_start]
            if (
                span[1] <= postcode_start
                and len(gap) <= _ADDRESS_WINDOW
                and _ADDRESS_GAP.fullmatch(gap)
                and not _BLANK_LINE.search(gap)
            ):
                return span
        return None

    for m in _POSTCODE.finditer(text):
        postcode = f"{m.group('out')}{m.group('in')}".upper()
        line = line_before(m.start(), streets) or line_before(m.start(), facilities)
        if line is None:
            out.append(Candidate("address", m.start(), m.end(), postcode, _RANK_ADDRESS))
            continue
        used.add(line)
        first_line = collapse(text[line[0] : line[1]]).lower().rstrip(",")
        out.append(
            Candidate("address", line[0], m.end(), f"{postcode}|{first_line}", _RANK_ADDRESS)
        )
    for span in streets:
        if span not in used:
            street = collapse(text[span[0] : span[1]]).lower()
            out.append(Candidate("address", span[0], span[1], street, _RANK_STREET))
    return out
