import string
from datetime import date

from hypothesis import given, settings
from hypothesis import strategies as st

from checks.key_facts import extract_key_facts
from checks.models import KeyFact
from checks.sentences import split_sentences

# All text here is invented. No real letters or personal data.

_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"]  # fmt: skip
_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _facts_of_type(text: str, kind: str) -> list[KeyFact]:
    facts = extract_key_facts(text)
    sentence_ids = {s.id for s in split_sentences(text)}
    for f in facts:
        assert text[f.start : f.end] == f.value
        assert f.sentence_id in sentence_ids
    return [f for f in facts if f.type == kind]


def _assert_round_trip(context: str, formatted: str, kind: str, expected: str) -> None:
    text = context.format(formatted)
    facts = _facts_of_type(text, kind)
    assert [f.normalised for f in facts] == [expected], (formatted, facts)
    assert facts[0].value == formatted


# --- dates -------------------------------------------------------------------

_dates = st.dates(min_value=date(2000, 1, 1), max_value=date(2099, 12, 31))


def _ordinal(day: int) -> str:
    if 11 <= day % 100 <= 13:
        return f"{day}th"
    suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"


def _date_formats(d: date) -> list[str]:
    name = _MONTHS[d.month - 1]
    weekday = _WEEKDAYS[d.weekday()]
    return [
        f"{d.day} {name} {d.year}",
        f"{_ordinal(d.day)} {name} {d.year}",
        f"{weekday}, {d.day} {name} {d.year}",
        f"{weekday} {d.day} {name[:3]} {d.year}",
        f"{name} {d.day}, {d.year}",
        f"{d.day:02d}/{d.month:02d}/{d.year}",
        f"{d.day}/{d.month}/{d.year}",
        f"{d.day}.{d.month}.{d.year}",
        f"{d.day}-{d.month}-{d.year}",
        f"{d.day:02d}/{d.month:02d}/{d.year % 100:02d}",
        d.isoformat(),
    ]


_DATE_CONTEXTS = [
    "You must pay the bill by {}.",
    "Your appointment is on {} at the clinic.",
    "The council made this decision on {}",
    "{} is the last day to reply.",
]


@settings(max_examples=150, deadline=None)
@given(_dates, st.data())
def test_date_round_trip(d: date, data: st.DataObject) -> None:
    """**Validates: Requirements 2.1, 2.2**"""
    formatted = data.draw(st.sampled_from(_date_formats(d)))
    context = data.draw(st.sampled_from(_DATE_CONTEXTS))
    _assert_round_trip(context, formatted, "date", d.isoformat())


@settings(max_examples=40, deadline=None)
@given(_dates)
def test_date_formats_share_normalised_value(d: date) -> None:
    """**Validates: Requirements 2.1, 2.2**"""
    for formatted in _date_formats(d):
        _assert_round_trip("You must reply by {}.", formatted, "date", d.isoformat())


# --- money -------------------------------------------------------------------

_pence = st.one_of(st.integers(0, 99), st.integers(0, 10_000), st.integers(0, 10**9))


def _money_formats(pence: int) -> list[str]:
    pounds, pp = divmod(pence, 100)
    formats = [f"£{pounds:,}.{pp:02d}", f"£{pounds}.{pp:02d}", f"GBP {pounds}.{pp:02d}"]
    if pp == 0:
        formats += [f"£{pounds}", f"£{pounds:,}", f"{pounds} pounds"]
    if pounds == 0:
        formats += [f"{pp}p", f"{pp} pence"]
    return formats


_MONEY_CONTEXTS = [
    "You need to pay {} for your council tax.",
    "The total is {}.",
    "The council will send you {} next week.",
    "{} is owed on this account.",
]


@settings(max_examples=150, deadline=None)
@given(_pence, st.data())
def test_money_round_trip(pence: int, data: st.DataObject) -> None:
    """**Validates: Requirements 2.1, 2.2**"""
    formatted = data.draw(st.sampled_from(_money_formats(pence)))
    context = data.draw(st.sampled_from(_MONEY_CONTEXTS))
    _assert_round_trip(context, formatted, "money", f"GBP {pence}")


@settings(max_examples=40, deadline=None)
@given(_pence)
def test_money_formats_share_normalised_value(pence: int) -> None:
    """**Validates: Requirements 2.1, 2.2**"""
    for formatted in _money_formats(pence):
        _assert_round_trip("The total is {}.", formatted, "money", f"GBP {pence}")


# --- references --------------------------------------------------------------


@st.composite
def _references(draw: st.DrawFn) -> tuple[str, str, str]:
    prefix = draw(st.text(alphabet=string.ascii_uppercase, max_size=3))
    digits = draw(st.text(alphabet=string.digits, min_size=3, max_size=9))
    suffix = draw(st.sampled_from(["", "A", "B", "C", "D"]))
    return prefix, digits, suffix


def _reference_formats(prefix: str, digits: str, suffix: str) -> list[str]:
    compact = f"{prefix}{digits}{suffix}"
    chunks = [digits[i : i + 2] for i in range(0, len(digits), 2)]
    spaced = " ".join(part for part in [prefix, *chunks, suffix] if part)
    return [compact, compact.lower(), spaced]


_REFERENCE_CONTEXTS = [
    "Your reference number is {}.",
    "Please quote claim number {} when you phone us.",
    "Our ref: {}",
    "Account number {} is now closed.",
]


@settings(max_examples=150, deadline=None)
@given(_references(), st.data())
def test_reference_round_trip(ref: tuple[str, str, str], data: st.DataObject) -> None:
    """**Validates: Requirements 2.1, 2.2**"""
    formatted = data.draw(st.sampled_from(_reference_formats(*ref)))
    context = data.draw(st.sampled_from(_REFERENCE_CONTEXTS))
    _assert_round_trip(context, formatted, "reference", "".join(ref))


@settings(max_examples=40, deadline=None)
@given(_references())
def test_reference_formats_share_normalised_value(ref: tuple[str, str, str]) -> None:
    """**Validates: Requirements 2.1, 2.2**"""
    for formatted in _reference_formats(*ref):
        _assert_round_trip("Your reference is {}.", formatted, "reference", "".join(ref))


# --- phones ------------------------------------------------------------------


@st.composite
def _uk_phones(draw: st.DrawFn) -> str:
    start = draw(st.sampled_from(["01", "02", "03", "07", "08"]))
    length = draw(st.sampled_from([10, 11])) if start in ("01", "08") else 11
    rest = draw(st.text(alphabet=string.digits, min_size=length - 2, max_size=length - 2))
    return start + rest


def _phone_formats(n: str) -> list[str]:
    return [
        n,
        f"{n[:4]} {n[4:7]} {n[7:]}",
        f"{n[:5]} {n[5:]}",
        f"{n[:3]} {n[3:7]} {n[7:]}",
        f"{n[:4]}-{n[4:7]}-{n[7:]}",
        f"+44 {n[1:4]} {n[4:7]} {n[7:]}",
        f"+44 (0){n[1:4]} {n[4:7]} {n[7:]}",
        f"+44{n[1:]}",
        f"({n[:4]}) {n[4:7]} {n[7:]}",
    ]


_PHONE_CONTEXTS = [
    "Call us on {}.",
    "Our phone number is {} if you have questions.",
    "You can phone {} from Monday to Friday.",
    "Phone: {}",
]


@settings(max_examples=150, deadline=None)
@given(_uk_phones(), st.data())
def test_phone_round_trip(number: str, data: st.DataObject) -> None:
    """**Validates: Requirements 2.1, 2.2**"""
    formatted = data.draw(st.sampled_from(_phone_formats(number)))
    context = data.draw(st.sampled_from(_PHONE_CONTEXTS))
    _assert_round_trip(context, formatted, "phone", number)


@settings(max_examples=40, deadline=None)
@given(_uk_phones())
def test_phone_formats_share_normalised_value(number: str) -> None:
    """**Validates: Requirements 2.1, 2.2**"""
    for formatted in _phone_formats(number):
        _assert_round_trip("Call us on {}.", formatted, "phone", number)


# --- unit tests --------------------------------------------------------------


def _normalised(text: str, kind: str) -> list[str]:
    return [f.normalised for f in _facts_of_type(text, kind)]


def test_empty_text_has_no_facts() -> None:
    assert extract_key_facts("") == []
    assert extract_key_facts(" \n\n ") == []


def test_facts_carry_source_sentence_and_span() -> None:
    text = (
        "Dear Ms Example,\n\nYour reference is HB/2026/0042. "
        "You must pay £45 by 1 April 2026. Call us on 0300 123 4567."
    )
    sentences = {s.id: s for s in split_sentences(text)}
    facts = extract_key_facts(text)
    by_value = {f.value: f for f in facts}
    for value, kind in [("HB/2026/0042", "reference"), ("£45", "money"),
                        ("1 April 2026", "date"), ("0300 123 4567", "phone")]:  # fmt: skip
        fact = by_value[value]
        assert fact.type == kind
        s = sentences[fact.sentence_id]
        assert s.start <= fact.start and fact.end <= s.end
    assert [f.id for f in facts] == [f"k{i}" for i in range(1, len(facts) + 1)]


def test_reference_keeps_slashes() -> None:
    assert _normalised("Our ref: hb/2026/0042", "reference") == ["HB/2026/0042"]


def test_relative_dates_keep_number_and_unit() -> None:
    assert _normalised("Reply within fourteen days.", "date") == ["14 days"]
    assert _normalised("Reply within 14 days.", "date") == ["14 days"]
    assert _normalised("We will reply in 28 working days.", "date") == ["28 working days"]


def test_ordinary_words_are_not_dates() -> None:
    assert _normalised("Section 3 may apply to you.", "date") == []


def test_times_normalise_to_24_hour() -> None:
    for text in ["Come at 9am.", "Come at 9:00 am.", "Come at 09:00."]:
        assert _normalised(text, "time") == ["09:00"]
    for text in ["Come at 2.30pm.", "Come at 14:30.", "Come at 2:30 p.m. please."]:
        assert _normalised(text, "time") == ["14:30"]
    assert _normalised("Come at 12 noon.", "time") == ["12:00"]


def test_money_in_pence_and_words() -> None:
    assert _normalised("Pay 45p now.", "money") == ["GBP 45"]
    assert _normalised("Pay £2.5 million.", "money") == ["GBP 250000000"]


def test_changed_digit_changes_normalised_value() -> None:
    assert _normalised("Pay £45.", "money") != _normalised("Pay £46.", "money")
    assert _normalised("Reply by 1 March 2026.", "date") != _normalised(
        "Reply by 1 March 2027.", "date"
    )


def test_address_is_postcode_plus_first_line() -> None:
    text = "Come to 1 Calverley Street, Leeds LS1 1UR."
    assert _normalised(text, "address") == ["LS11UR|1 calverley street"]
    same = "The address is 1 Calverley Street\nLeeds\nls1 1ur"
    assert _normalised(same, "address") == ["LS11UR|1 calverley street"]
    assert _normalised("Send it to LS1 1UR.", "address") == ["LS11UR"]


def test_action_keeps_verb_object_and_deadline() -> None:
    original = _normalised("You must send the form back by 14 March 2026.", "action")
    assert original == ["send back|form|date=2026-03-14"]
    assert _normalised("Send back the form by 14 March 2026.", "action") == original


def test_action_phrasal_verb_is_one_lemma() -> None:
    assert _normalised("Please fill in the form.", "action") == ["fill in|form|"]


def test_action_synonyms_from_config() -> None:
    assert _normalised("Submit the form.", "action") == _normalised("Send the form.", "action")
    assert _normalised("Complete the form.", "action") == ["fill in|form|"]


def test_action_with_money_and_changed_amount() -> None:
    assert _normalised("You need to pay £45 by 1 April 2026.", "action") == [
        "pay||date=2026-04-01,money=GBP 4500"
    ]
    assert _normalised("Pay £45 by 1 April 2026.", "action") != _normalised(
        "Pay £54 by 1 April 2026.", "action"
    )


def test_negated_action_differs() -> None:
    assert _normalised("Do not send cash.", "action") == ["not send|cash|"]
    assert _normalised("Send cash.", "action") == ["send|cash|"]


def test_non_actions_are_ignored() -> None:
    assert _normalised("Thank you for your letter.", "action") == []
    assert _normalised("The council got your form.", "action") == []


def test_active_request_extracts_the_same_action_as_the_passive() -> None:
    passive = _normalised("You are asked to send the form.", "action")
    assert passive == ["send|form|"]
    assert _normalised("The council asks you to send the form.", "action") == passive
    required = _normalised("You are required to pay £45.", "action")
    assert required == ["pay||money=GBP 4500"]
    assert _normalised("The council requires you to pay £45.", "action") == required
    assert _normalised("We expect you to sign the form.", "action") == ["sign|form|"]


def test_letter_says_you_must_extracts_the_action() -> None:
    assert _normalised("The letter says you must pay £45 by 1 April 2026.", "action") == _normalised(
        "You must pay £45 by 1 April 2026.", "action"
    )


def test_verb_and_object_synonym_uses_up_the_object() -> None:
    assert _normalised("Make a payment of £45.", "action") == ["pay||money=GBP 4500"]
    assert _normalised("Make an application for a bus pass.", "action") == ["apply||"]
    # "make" with another object is not a payment.
    assert _normalised("Make a copy of the form.", "action") == ["make|copy|"]


def test_new_single_word_synonyms() -> None:
    assert _normalised("Please attend the meeting.", "action") == ["go|meeting|"]
    assert _normalised("Please respond by 1 March 2026.", "action") == _normalised(
        "Please reply by 1 March 2026.", "action"
    )
    assert _normalised("Please request a new form.", "action") == ["ask|form|"]


def test_synonym_targets_are_never_swapped_again() -> None:
    from checks.config import ACTION_SYNONYMS

    assert not set(ACTION_SYNONYMS.values()) & set(ACTION_SYNONYMS)


def test_date_without_a_year_keeps_month_and_day() -> None:
    assert _normalised("Reply by 1 March.", "date") == ["--03-01"]


def test_joined_verb_done_to_you_is_not_your_action() -> None:
    """Regression: "or even take you to court" is the council's action, but
    spaCy joined it to "pay", so P1 asked the output to keep "take"."""
    text = "The Council may ask you to pay all you owe straight away, or even take you to court."
    phrases = [f.normalised.split("|")[0] for f in extract_key_facts(text) if f.type == "action"]
    assert "take" not in phrases


def test_glued_pdf_text_is_not_an_action() -> None:
    text = "Do it online at example.gov.uk/billsmake the switch today."
    phrases = [f.normalised.split("|")[0] for f in extract_key_facts(text) if f.type == "action"]
    assert all(p.replace(" ", "").replace("-", "").isalpha() for p in phrases)


def test_action_stops_where_a_joined_verb_clause_starts() -> None:
    """Regression: spaCy attached "4 April 2034" to the first "pay", after the
    "and you must pay £5" clause, so the first action held both dates and P1
    failed lines that kept each date with its own amount."""
    text = "You must pay £1 by 1 January 2020 and you must pay £5 by 4 April 2034."
    actions = [f.normalised for f in extract_key_facts(text) if f.type == "action"]
    assert actions == [
        "pay||date=2020-01-01,money=GBP 100",
        "pay||date=2034-04-04,money=GBP 500",
    ]


def test_wrapped_action_keeps_its_object_and_date() -> None:
    """Regression: layout line breaks split wrapped prose, so "please
    contact\\nCitizens Advice" gave no action and "before\\n1 April 2026" lost
    its date."""
    contact = "If you have not already paid, please contact\nCitizens Advice for free help."
    assert [f.normalised for f in extract_key_facts(contact) if f.type == "action"] != []
    pay = (
        "If you have not already paid, you must pay the full amount shown on this notice before\n"
        "1 April 2026 at the latest."
    )
    assert [f.normalised for f in extract_key_facts(pay) if f.type == "action"] == [
        "pay|amount|date=2026-04-01"
    ]


def test_joined_action_stops_before_a_because_or_if_clause() -> None:
    """Regression: the joined verb's span ran to the end of the sentence, so
    "because ..." and a dated "if ..." clause became part of the action."""
    for text in [
        "You must pay £45 and send the form back, because the council needs it by 3 March 2026.",
        "You must pay £45 and send the form back, if you moved on 3 March 2026.",
    ]:
        actions = [(f.value, f.normalised) for f in extract_key_facts(text) if f.type == "action"]
        assert actions == [
            ("You must pay £45", "pay||money=GBP 4500"),
            ("send the form back", "send back|form|"),
        ], text


def test_joined_action_still_keeps_its_own_date() -> None:
    text = "You must pay £45 and send the form back by 3 March 2026."
    actions = [f.normalised for f in extract_key_facts(text) if f.type == "action"]
    assert actions == ["pay||money=GBP 4500", "send back|form|date=2026-03-03"]


def test_short_label_lines_keep_their_own_action_and_date() -> None:
    """Regression (review v2): short label and value lines merged into 1
    sentence, so "Pay by 1 April 2026" lost its action and "Next instalment 1
    May 2026" gave its date to the action in the line before."""
    due = "Amount due now £120.00\nPay by 1 April 2026"
    assert [f.normalised for f in extract_key_facts(due) if f.type == "action"] == ["pay||date=2026-04-01"]
    balance = "Please pay the balance now\nNext instalment 1 May 2026"
    assert [f.normalised for f in extract_key_facts(balance) if f.type == "action"] == ["pay|balance|"]
