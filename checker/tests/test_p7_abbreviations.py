from hypothesis import given, settings
from hypothesis import strategies as st
from strategies import text_lines

from checks.models import KeyFact
from checks.p7_abbreviations import check_p7

# All text here is invented. No real letters or personal data.

_NAME_WORDS = ["Personal", "Housing", "Health", "Support", "Payment", "Service", "Council",
               "Benefit", "Care", "Money", "Office", "Water", "Energy", "Advice", "Team"]  # fmt: skip
_LINK_WORDS = ["for", "and", "of"]
_USES = ["{a} will send you a letter.", "You can phone {a} for help.", "{a} will check your claim."]


@st.composite
def _expansions(draw: st.DrawFn) -> tuple[str, str]:
    """Full words and their abbreviation, such as ("Housing Support for Care", "HSC")."""
    words = draw(st.lists(st.sampled_from(_NAME_WORDS), min_size=2, max_size=4))
    parts = [words[0]]
    for word in words[1:]:
        if draw(st.integers(min_value=0, max_value=3)) == 0:
            parts.append(draw(st.sampled_from(_LINK_WORDS)))
        parts.append(word)
    return " ".join(parts), "".join(w[0] for w in words)


@st.composite
def _explained(draw: st.DrawFn, full: str, abbreviation: str) -> str:
    """A line that expands the abbreviation, in either of the 2 accepted patterns."""
    if draw(st.booleans()):
        return f"The {full} ({abbreviation}) will phone you."
    return f"{abbreviation} ({full}) will phone you."


@st.composite
def _use(draw: st.DrawFn, abbreviation: str) -> str:
    return draw(st.sampled_from(_USES)).format(a=abbreviation)


@settings(max_examples=50, deadline=None)
@given(_expansions(), st.integers(min_value=0, max_value=4), st.data())
def test_abbreviation_expanded_on_first_use_passes(
    expansion: tuple[str, str], uses: int, data: st.DataObject
) -> None:
    """**Validates: Requirements 3.1; P7**"""
    full, abbreviation = expansion
    texts = [data.draw(_explained(full, abbreviation))]
    texts += [data.draw(_use(abbreviation)) for _ in range(uses)]
    result = check_p7("", [], text_lines(texts))
    assert result.rule == "P7"
    assert result.passed, result.details
    assert result.line_ids == []


@settings(max_examples=50, deadline=None)
@given(_expansions(), st.integers(min_value=1, max_value=3), st.integers(min_value=0, max_value=3), st.data())
def test_abbreviation_used_before_its_expansion_fails(
    expansion: tuple[str, str], before: int, after: int, data: st.DataObject
) -> None:
    """**Validates: Requirements 3.1; P7**"""
    full, abbreviation = expansion
    texts = [data.draw(_use(abbreviation)) for _ in range(before)]
    texts.append(data.draw(_explained(full, abbreviation)))
    texts += [data.draw(_use(abbreviation)) for _ in range(after)]
    lines = text_lines(texts)
    result = check_p7("", [], lines)
    assert not result.passed
    assert result.line_ids == [line.id for line in lines[:before]]


@settings(max_examples=50, deadline=None)
@given(_expansions(), st.integers(min_value=1, max_value=4), st.data())
def test_abbreviation_never_expanded_fails_every_use(
    expansion: tuple[str, str], uses: int, data: st.DataObject
) -> None:
    """**Validates: Requirements 3.1; P7**"""
    _, abbreviation = expansion
    lines = text_lines([data.draw(_use(abbreviation)) for _ in range(uses)])
    result = check_p7("", [], lines)
    assert not result.passed
    assert result.line_ids == [line.id for line in lines]


def test_unexplained_abbreviation_fails() -> None:
    """Checker-must-fail case from the Easy Read rules. **Validates: Requirements 3.1; P7**"""
    result = check_p7("", [], text_lines(["You can get PIP."]))
    assert not result.passed
    assert result.line_ids == ["l1"]
    assert result.details == ["l1 has 1 abbreviations that are not explained"]


def test_wrong_expansion_fails() -> None:
    """Checker-must-fail case. **Validates: Requirements 3.1; P7**"""
    assert not check_p7("", [], text_lines(["You can get Housing Benefit (PIP)."])).passed


def test_capitals_for_emphasis_fail() -> None:
    """Checker-must-fail case. **Validates: Requirements 3.1; P7**"""
    assert not check_p7("", [], text_lines(["You MUST quote your reference."])).passed


def test_plural_abbreviation_fails_until_expanded() -> None:
    assert not check_p7("", [], text_lines(["Ask one of our GPs."])).passed
    assert check_p7("", [], text_lines(["Our general practitioners (GPs) can help."])).passed


def test_both_expansion_patterns_pass() -> None:
    lines = text_lines([
        "You can get Personal Independence Payment (PIP).",
        "PIP is money from the government.",
        "The DWP (Department for Work and Pensions) will phone you.",
    ])  # fmt: skip
    assert check_p7("", [], lines).passed


def test_references_and_postcodes_are_not_abbreviations() -> None:
    lines = text_lines(["Your reference is AB123456.", "Send it to 1 High Street, LS1 4AB."])
    assert check_p7("", [], lines).passed


def test_no_lines_pass() -> None:
    assert check_p7("", [], []).passed


def _address_fact(original: str, value: str) -> KeyFact:
    start = original.index(value)
    return KeyFact(
        id="f1", type="address", value=value, normalised=value.replace(" ", ""),
        start=start, end=start + len(value), sentence_id="s1",
    )  # fmt: skip


def test_address_lines_before_a_key_fact_postcode_pass() -> None:
    """Regression: a line that copied "PO BOX 3" from an address failed P7.
    The model must not reword an address."""
    original = "Write to PO BOX 3, Northbridge, NB1 9ZZ."
    fact = _address_fact(original, "NB1 9ZZ")
    assert check_p7(original, [fact], text_lines(["Write to PO BOX 3, Northbridge, NB1 9ZZ."])).passed


def test_capitals_away_from_a_key_fact_address_still_fail() -> None:
    """Still fails: with no address key fact, a postcode that isn't one, or
    capitals outside the address run."""
    original = "Write to PO BOX 3, Northbridge, NB1 9ZZ."
    line = "Write to PO BOX 3, Northbridge, NB1 9ZZ."
    assert not check_p7(original, [], text_lines([line])).passed
    other = _address_fact("Write to LS1 4AB.", "LS1 4AB")
    assert not check_p7(original, [other], text_lines([line])).passed
    fact = _address_fact(original, "NB1 9ZZ")
    for text in ["You MUST write to PO BOX 3, NB1 9ZZ.", "The DWP is at NB1 9ZZ.", "PO BOX 3."]:
        assert not check_p7(original, [fact], text_lines([text])).passed, text


def test_address_capitals_the_original_lacks_still_fail() -> None:
    """The address run must not pass an abbreviation the model added to an address."""
    original = "Please write to PO Box 3, Manchester, M15 5BA."
    fact = _address_fact(original, "M15 5BA")
    assert check_p7(original, [fact], text_lines(["Write to PO Box 3, Manchester, M15 5BA."])).passed
    for text in ["Write to DWP HMRC, PO Box 3, Manchester, M15 5BA.", "Write to DWP, M15 5BA."]:
        assert not check_p7(original, [fact], text_lines([text])).passed, text
    # Capitals elsewhere in the letter are not part of the address.
    original = "The DWP sent this. Please write to PO Box 3, Manchester, M15 5BA."
    fact = _address_fact(original, "M15 5BA")
    assert not check_p7(original, [fact], text_lines(["Write to DWP, M15 5BA."])).passed


def test_placeholder_copied_from_the_original_passes() -> None:
    """Regression: a template letter prints "XXXXXXXXX", and the copied line failed P7."""
    original = "Quote your reference XXXXXXXXX when you pay."
    assert check_p7(original, [], text_lines(["Give your reference XXXXXXXXX when you pay."])).passed


def test_placeholder_not_in_the_original_fails() -> None:
    """Still fails: a run of X's the Original lacks, 2 X's, and a real
    abbreviation next to a copied placeholder."""
    original = "Quote your reference XXXXXXXXX."
    assert not check_p7(original, [], text_lines(["Give the reference XXXXXX."])).passed
    assert not check_p7("Box XX.", [], text_lines(["Write to Box XX."])).passed
    assert not check_p7(original, [], text_lines(["Give PIP reference XXXXXXXXX."])).passed
