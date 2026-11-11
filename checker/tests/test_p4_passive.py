from hypothesis import given, settings
from hypothesis import strategies as st

from checks.models import Line
from checks.p4_passive import check_p4

# All text here is invented. No real letters or personal data.

# --- generators --------------------------------------------------------------

# (base, past tense, past participle, -ing form)
_VERBS = [
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
_OBJECTS = ["letter", "form", "claim", "payment", "account", "application", "bill", "request"]
_AGENTS = ["council", "office", "team", "bank", "doctor", "landlord"]

# (passive form, its active form). Each pair says the same thing.
_TEMPLATES = [
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
def _pairs(draw: st.DrawFn) -> tuple[str, str]:
    """A passive sentence and its active form."""
    index = draw(st.integers(min_value=0, max_value=len(_TEMPLATES) - 1))
    verbs = [v for v in _VERBS if index != _AGENTLESS or v[0] not in _ADJECTIVE_LIKE]
    base, past, pp, ing = draw(st.sampled_from(verbs))
    slots = {"o": draw(st.sampled_from(_OBJECTS)), "a": draw(st.sampled_from(_AGENTS)),
             "base": base, "past": past, "pp": pp, "ing": ing}  # fmt: skip
    passive, active = _TEMPLATES[index]
    return passive.format(**slots), active.format(**slots)


def _lines(texts: list[str]) -> list[Line]:
    return [
        Line(id=f"l{i}", text=t, source_sentence_id="s1", symbol_id=None)
        for i, t in enumerate(texts, start=1)
    ]


# --- properties --------------------------------------------------------------


@settings(max_examples=60, deadline=None)
@given(st.lists(_pairs(), min_size=1, max_size=4), st.data())
def test_passive_sentences_fail_and_their_active_forms_pass(
    pairs: list[tuple[str, str]], data: st.DataObject
) -> None:
    """**Validates: Requirements 3.1; P4**"""
    active = check_p4("", [], _lines([a for _, a in pairs]))
    assert active.rule == "P4"
    assert active.passed, active.details
    assert active.line_ids == []

    # Make some lines passive: exactly those lines fail.
    flags = data.draw(st.lists(st.booleans(), min_size=len(pairs), max_size=len(pairs)))
    flags[data.draw(st.integers(min_value=0, max_value=len(pairs) - 1))] = True
    lines = _lines([p if f else a for (p, a), f in zip(pairs, flags)])
    mixed = check_p4("", [], lines)
    assert not mixed.passed
    assert mixed.line_ids == [line.id for line, f in zip(lines, flags) if f]


# --- checker-must-fail cases and examples ------------------------------------


def test_passive_sentence_fails() -> None:
    """Checker-must-fail case from the brief. **Validates: Requirements 3.1; P4**"""
    result = check_p4("", [], _lines(["A letter will be sent to you."]))
    assert not result.passed
    assert result.line_ids == ["l1"]
    assert result.details == ["l1 uses the passive voice"]


def test_active_form_passes() -> None:
    assert check_p4("", [], _lines(["The council will send you a letter."])).passed


def test_only_passive_lines_are_reported() -> None:
    lines = _lines([
        "The council got your form.",
        "Your rental liability has been reassessed.",
        "You need to pay £45.",
    ])  # fmt: skip
    assert check_p4("", [], lines).line_ids == ["l2"]


def test_no_lines_pass() -> None:
    assert check_p4("", [], []).passed
