import json

from hypothesis import given, settings
from hypothesis import strategies as st

from checks.config import SYMBOL_INDEX_PATH
from checks.models import Line
from checks.p8_symbols import check_p8, symbol_ids

# All text here is invented. No real letters or personal data.

_KNOWN = sorted(symbol_ids())

_known_ids = st.sampled_from(_KNOWN)

# Strings outside the index: other numbers, numbers with stray characters,
# and free text a model might guess.
_unknown_ids = st.one_of(
    st.integers(min_value=0, max_value=10**7).map(str),
    _known_ids.map(lambda i: f"{i}.0"),
    _known_ids.map(lambda i: f" {i}"),
    st.text(min_size=0, max_size=12),
).filter(lambda i: i not in symbol_ids())

# Each slot is (kind, id): "known", "unknown" or "none".
_slot = st.one_of(
    st.tuples(st.just("known"), _known_ids),
    st.tuples(st.just("unknown"), _unknown_ids),
    st.tuples(st.just("none"), st.none()),
)


def _lines(ids: list[str | None]) -> list[Line]:
    return [
        Line(id=f"l{i}", text="The council will send you a letter.", source_sentence_id="s1", symbol_id=s)
        for i, s in enumerate(ids, start=1)
    ]


@settings(max_examples=100, deadline=None)
@given(st.lists(st.one_of(_known_ids, st.none()), min_size=1, max_size=8))
def test_ids_from_index_and_null_ids_pass(ids: list[str | None]) -> None:
    """**Validates: Requirements 4.3; P8**"""
    result = check_p8("", [], _lines(ids))
    assert result.rule == "P8"
    assert result.passed, result.details
    assert result.line_ids == []


@settings(max_examples=100, deadline=None)
@given(st.lists(_slot, min_size=1, max_size=8), _unknown_ids, st.data())
def test_ids_outside_index_fail(slots: list[tuple[str, str | None]], unknown: str, data: st.DataObject) -> None:
    """**Validates: Requirements 4.3; P8**"""
    slots[data.draw(st.integers(min_value=0, max_value=len(slots) - 1))] = ("unknown", unknown)
    lines = _lines([s for _, s in slots])
    result = check_p8("", [], lines)
    assert not result.passed
    assert result.line_ids == [line.id for line, (kind, _) in zip(lines, slots) if kind == "unknown"]


def test_made_up_id_fails() -> None:
    """Checker-must-fail case from the Easy Read rules. **Validates: Requirements 4.3; P8**"""
    result = check_p8("", [], _lines(["made-up-pictogram-42"]))
    assert not result.passed
    assert result.line_ids == ["l1"]
    assert result.details == ["l1 has a symbol ID that is not in the symbol index"]


def test_known_id_passes() -> None:
    assert check_p8("", [], _lines(["2239"])).passed


def test_no_lines_pass() -> None:
    assert check_p8("", [], []).passed


def test_index_format() -> None:
    """**Validates: Requirements 4.4**"""
    entries = json.loads(SYMBOL_INDEX_PATH.read_text(encoding="utf-8"))
    assert len(entries) > 10_000
    assert all(isinstance(e["id"], str) for e in entries)
    assert {(e["set"], e["licence"]) for e in entries} == {("arasaac", "CC BY-NC-SA")}
    assert set(entries[0]) == {"id", "keywords", "plurals", "lemmas", "categories", "tags", "set", "licence"}
