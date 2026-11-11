"""Shared Hypothesis strategies.

`synthetic_letters` builds invented letters with random dates, amounts and
reference numbers in long, passive sentences. It is used by the
`check_easy_read` property and kept for the pipeline property in task 30
(design "Testing Strategy").

All text here is invented. No real letters or personal data.
"""

from datetime import date

from hypothesis import strategies as st

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]  # fmt: skip

# --- key-fact values ---------------------------------------------------------

dates = st.dates(min_value=date(2020, 1, 1), max_value=date(2035, 12, 31)).flatmap(
    lambda d: st.sampled_from(
        [f"{d.day} {MONTHS[d.month - 1]} {d.year}", f"{d.day:02d}/{d.month:02d}/{d.year}"]
    )
)
money = st.builds(
    lambda pounds, pence: f"£{pounds:,}" + (f".{pence:02d}" if pence is not None else ""),
    st.integers(min_value=1, max_value=99_999),
    st.none() | st.integers(min_value=0, max_value=99),
)
references = st.builds(
    lambda letters, digits: f"{letters}{digits}",
    st.text(alphabet="ABCDEFGHJKLMNPRSTUVWXYZ", min_size=2, max_size=2),
    st.integers(min_value=100_000, max_value=999_999),
)
phones = st.builds(
    lambda area, rest: f"{area} {rest[:3]} {rest[3:]}",
    st.sampled_from(["0300", "0800", "0161", "0113"]),
    st.integers(min_value=0, max_value=9_999_999).map(lambda n: f"{n:07d}"),
)
times = st.sampled_from(["9am", "10:30am", "2pm", "14:30", "11.15am"])

FACT_VALUES = {"money": money, "date": dates, "reference": references, "phone": phones,
               "time": times}  # fmt: skip

# --- passive sentences and their active forms ---------------------------------

# (base, past tense, past participle, -ing form)
VERBS = [
    ("send", "sent", "sent", "sending"),
    ("check", "checked", "checked", "checking"),
    ("receive", "received", "received", "receiving"),
    ("review", "reviewed", "reviewed", "reviewing"),
    ("approve", "approved", "approved", "approving"),
    ("cancel", "cancelled", "cancelled", "cancelling"),
    ("pay", "paid", "paid", "paying"),
    ("post", "posted", "posted", "posting"),
    ("change", "changed", "changed", "changing"),
    ("close", "closed", "closed", "closing"),
    ("refuse", "refused", "refused", "refusing"),
    ("process", "processed", "processed", "processing"),
    ("sign", "signed", "signed", "signing"),
]
OBJECTS = ["letter", "form", "claim", "payment", "account", "application", "bill", "request"]
AGENTS = ["council", "office", "team", "bank", "doctor", "landlord"]

# (passive form, its active form). Each pair says the same thing.
_PAIR_TEMPLATES = [
    ("The {o} was {pp} by the {a}.", "The {a} {past} the {o}."),
    ("Your {o} will be {pp} by the {a}.", "The {a} will {base} your {o}."),
    ("Your {o} has been {pp} by the {a}.", "The {a} has {pp} your {o}."),
    ("Your {o} is being {pp} by the {a}.", "The {a} is {ing} your {o}."),
    ("Your {o} was {pp}.", "The {a} {past} your {o}."),
]
# With no agent, en_core_web_sm reads "closed" as an adjective (see p4_passive.py).
_AGENTLESS = 4
_ADJECTIVE_LIKE = {"close"}


@st.composite
def passive_active_pairs(draw: st.DrawFn) -> tuple[str, str]:
    """A short passive sentence and its active form."""
    index = draw(st.integers(min_value=0, max_value=len(_PAIR_TEMPLATES) - 1))
    verbs = [v for v in VERBS if index != _AGENTLESS or v[0] not in _ADJECTIVE_LIKE]
    base, past, pp, ing = draw(st.sampled_from(verbs))
    slots = {"o": draw(st.sampled_from(OBJECTS)), "a": draw(st.sampled_from(AGENTS)),
             "base": base, "past": past, "pp": pp, "ing": ing}  # fmt: skip
    passive, active = _PAIR_TEMPLATES[index]
    return passive.format(**slots), active.format(**slots)


# --- synthetic letters ----------------------------------------------------------

# Long, passive sentences. Each has more than 15 words before its key-fact
# values are filled in, so every one breaks P2, and each uses a passive verb,
# so every one breaks P4. The tuple lists the key-fact slots it holds.
LONG_PASSIVE_SENTENCES: list[tuple[str, tuple[str, ...]]] = [
    ("Following a recent review of your council tax account, a payment of {money} "
     "will be collected from your bank account on {date}.", ("money", "date")),
    ("Your {o} was {pp} by the {a} on {date} and the outstanding balance of {money} "
     "has now been added to your account.", ("date", "money")),
    ("Any further letters about this matter will be sent to you by the {a} under the "
     "reference number {reference} shown above.", ("reference",)),
    ("A penalty charge of {money} has been issued to you because your {o} was not {pp} "
     "by the {a} before {date}.", ("money", "date")),
    ("If the full amount is not received by {date}, further recovery action may be taken "
     "against you by the {a} without any further notice.", ("date",)),
    ("Your appointment at the local office has been booked for {time} on {date} and "
     "should not be missed under any circumstances.", ("time", "date")),
    ("Payment can be made by telephone on {phone} by quoting the reference {reference} "
     "that is printed at the top of this letter.", ("phone", "reference")),
]
# Every letter holds at least one date, one amount and one reference number.
_REQUIRED = (0, 2)


def fill_sentence(template: str, slots: tuple[str, ...], draw: st.DrawFn) -> str:
    """Fill a long passive sentence with random key-fact values and words."""
    pp = draw(st.sampled_from([v for v in VERBS if v[0] not in _ADJECTIVE_LIKE]))[2]
    words = {"o": draw(st.sampled_from(OBJECTS)), "a": draw(st.sampled_from(AGENTS)), "pp": pp}
    return template.format(**words, **{slot: draw(FACT_VALUES[slot]) for slot in slots})


@st.composite
def synthetic_letters(draw: st.DrawFn, max_extra: int = 4) -> str:
    """An invented letter of long, passive sentences with random key facts.

    It always has at least one date, money amount and reference number, plus up
    to `max_extra` more sentences that may add times and phone numbers.
    """
    extra = draw(st.lists(st.integers(0, len(LONG_PASSIVE_SENTENCES) - 1), max_size=max_extra))
    order = draw(st.permutations([*_REQUIRED, *extra]))
    return " ".join(fill_sentence(*LONG_PASSIVE_SENTENCES[i], draw) for i in order)
