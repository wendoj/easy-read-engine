"""Key-fact spans in output lines, for highlighting (task 25, R5.3).

All text here is invented. No real letters or personal data.
"""

from hypothesis import given, settings
from hypothesis import strategies as st
from strategies import FACT_VALUES

from checks import analyse, line_fact_spans
from checks.models import Line
from checks.p1_key_facts import check_p1

_TEMPLATES = [
    ("You must pay {money} by {date}.", ("money", "date")),
    ("Your reference number is {reference}.", ("reference",)),
    ("Please call the council on {phone}.", ("phone",)),
    ("Your appointment is at {time} on {date}.", ("time", "date")),
    ("The council looked at your claim again.", ()),
]


@st.composite
def _letters(draw: st.DrawFn) -> str:
    templates = draw(st.lists(st.sampled_from(_TEMPLATES), min_size=1, max_size=5))
    return " ".join(t.format(**{s: draw(FACT_VALUES[s]) for s in slots}) for t, slots in templates)


@settings(max_examples=40, deadline=None)
@given(_letters(), st.data())
def test_every_fact_in_faithful_lines_gets_a_span(original: str, data: st.DataObject) -> None:
    """**Validates: Requirements 5.3**

    Lines that copy the Original's sentences, in any order, keep every key
    fact. Each fact then has a span, and every span is inside its line and
    names a fact from the Original with the same type and normalised value.
    """
    analysis = analyse(original)
    lines = [
        Line(id=f"l{i}", text=s.text, source_sentence_id=s.id, symbol_id=None)
        for i, s in enumerate(analysis.sentences, start=1)
    ]
    lines = data.draw(st.permutations(lines))
    assert check_p1(original, analysis.key_facts, lines).passed

    spans = line_fact_spans(analysis.key_facts, lines)
    text = {line.id: line.text for line in lines}
    facts = {f.id: f for f in analysis.key_facts}
    for span in spans:
        assert span.fact_id in facts
        assert 0 <= span.start < span.end <= len(text[span.line_id])
    keys = {(facts[s.fact_id].type, facts[s.fact_id].normalised) for s in spans}
    assert keys == {(f.type, f.normalised) for f in analysis.key_facts}


def test_reformatted_value_is_matched_by_normalised_value() -> None:
    original = "You must pay £45.00 by 01/04/2026."
    analysis = analyse(original)
    lines = [Line(id="l1", text="You must pay £45 by 1 April 2026.", source_sentence_id="s1", symbol_id=None)]
    spans = line_fact_spans(analysis.key_facts, lines)
    by_type = {next(f.type for f in analysis.key_facts if f.id == s.fact_id): lines[0].text[s.start : s.end] for s in spans}
    assert by_type["money"] == "£45"
    assert by_type["date"] == "1 April 2026"


def test_changed_value_gets_no_span() -> None:
    analysis = analyse("You must pay £45 by 1 April 2026.")
    lines = [Line(id="l1", text="You must pay £46.", source_sentence_id="s1", symbol_id=None)]
    facts = {f.id: f for f in analysis.key_facts}
    assert all(facts[s.fact_id].type != "money" for s in line_fact_spans(analysis.key_facts, lines))


def test_shared_value_names_the_fact_from_the_source_sentence() -> None:
    analysis = analyse("Your bill is £45. You must pay £45 by 1 April 2026.")
    money = [f for f in analysis.key_facts if f.type == "money"]
    assert len(money) == 2
    lines = [Line(id="l1", text="You must pay £45.", source_sentence_id=money[1].sentence_id, symbol_id=None)]
    spans = [s for s in line_fact_spans(analysis.key_facts, lines) if s.fact_id in {m.id for m in money}]
    assert [s.fact_id for s in spans] == [money[1].id]


def test_no_lines_gives_no_spans() -> None:
    assert line_fact_spans(analyse("You must pay £45.").key_facts, []) == []
