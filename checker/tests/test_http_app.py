"""HTTP adapter tests (task 12). All text here is invented, with no real personal data."""

import logging

import pytest
from fastapi.testclient import TestClient

from checks.config import MAX_LINE_CHARS, MAX_LINES, MAX_ORIGINAL_CHARS, MAX_SYMBOL_QUERY_CHARS
from http_app import MAX_BODY_BYTES, _StripQueryFilter, app

RULES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]

ORIGINAL = (
    "Your council tax payment of £45 was not received. "
    "You must pay £45 by 1 April 2026. "
    "Please call 0300 123 4567 if you have questions."
)

# A marker that must never come back in an error response.
SECRET = "Marigold Avenue 9Z7 ZZZ"


@pytest.fixture(scope="module")
def client() -> TestClient:
    # Entering the context runs the lifespan, which loads spaCy and the index.
    with TestClient(app) as c:
        yield c


def _lines() -> list[dict]:
    return [
        {"id": "l1", "text": "The council did not get your payment of £45.", "source_sentence_id": "s1", "symbol_id": None},
        {"id": "l2", "text": "You must pay £45 by 1 April 2026.", "source_sentence_id": "s2", "symbol_id": None},
        {"id": "l3", "text": "You can phone 0300 123 4567 with questions.", "source_sentence_id": "s3", "symbol_id": None},
    ]


# --- routes return the expected shape ----------------------------------------


def test_health_reports_spacy_loaded(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["spacy_loaded"] is True
    assert body["symbol_index_loaded"] is True
    assert body["spacy_model"] == "en_core_web_sm"


def test_analyse_returns_sentences_and_key_facts(client: TestClient) -> None:
    res = client.post("/analyse", json={"original": ORIGINAL})
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"sentences", "key_facts"}
    assert [s["id"] for s in body["sentences"]] == ["s1", "s2", "s3"]
    for s in body["sentences"]:
        assert ORIGINAL[s["start"] : s["end"]] == s["text"]
    sentence_ids = {s["id"] for s in body["sentences"]}
    types = {f["type"] for f in body["key_facts"]}
    assert {"money", "date", "phone"} <= types
    assert all(f["sentence_id"] in sentence_ids for f in body["key_facts"])


def test_key_facts_returns_list_of_facts(client: TestClient) -> None:
    res = client.post("/key-facts", json={"text": ORIGINAL})
    assert res.status_code == 200
    facts = res.json()
    assert isinstance(facts, list) and facts
    assert set(facts[0]) == {"id", "type", "value", "normalised", "start", "end", "sentence_id"}


def test_check_returns_eight_results_in_rule_order(client: TestClient) -> None:
    facts = client.post("/analyse", json={"original": ORIGINAL}).json()["key_facts"]
    res = client.post("/check", json={"original": ORIGINAL, "key_facts": facts, "lines": _lines()})
    assert res.status_code == 200
    results = res.json()
    assert [r["rule"] for r in results] == RULES
    for r in results:
        assert set(r) == {"rule", "passed", "line_ids", "failed_fact_ids", "details"}


def test_check_reports_p1_failure_for_changed_amount(client: TestClient) -> None:
    facts = client.post("/analyse", json={"original": ORIGINAL}).json()["key_facts"]
    lines = _lines()
    lines[1]["text"] = "You must pay £46 by 1 April 2026."
    results = client.post("/check", json={"original": ORIGINAL, "key_facts": facts, "lines": lines}).json()
    p1 = results[0]
    assert p1["rule"] == "P1" and p1["passed"] is False and p1["failed_fact_ids"]


def test_symbols_returns_list(client: TestClient) -> None:
    res = client.get("/symbols", params={"q": "pay", "limit": 3})
    assert res.status_code == 200
    assert res.json() == []  # find_symbol is a stub until task 23


# --- invalid and oversized input ---------------------------------------------


def _assert_no_echo(res) -> None:
    assert SECRET not in res.text
    for issue in res.json()["detail"]:
        assert set(issue) == {"loc", "type"}


def test_invalid_body_gets_422_without_echoing_text(client: TestClient) -> None:
    # Wrong field name, so the submitted text is the "input" FastAPI would echo.
    res = client.post("/analyse", json={"letter": SECRET})
    assert res.status_code == 422
    _assert_no_echo(res)


def test_invalid_line_gets_422_without_echoing_text(client: TestClient) -> None:
    bad_line = {"id": "l1", "text": 123, "source_sentence_id": "s1"}  # wrong type, no symbol_id
    res = client.post("/check", json={"original": SECRET, "key_facts": [], "lines": [bad_line]})
    assert res.status_code == 422
    _assert_no_echo(res)
    locs = [issue["loc"] for issue in res.json()["detail"]]
    assert ["body", "lines", 0, "text"] in locs


def test_malformed_json_gets_422_without_echoing_text(client: TestClient) -> None:
    res = client.post("/analyse", content='{"original": "' + SECRET, headers={"content-type": "application/json"})
    assert res.status_code == 422
    _assert_no_echo(res)


def test_oversized_original_is_rejected(client: TestClient) -> None:
    text = SECRET + " " + "word " * (MAX_ORIGINAL_CHARS // 5)
    res = client.post("/analyse", json={"original": text})
    assert res.status_code == 422
    assert res.json()["detail"] == [{"loc": ["body", "original"], "type": "string_too_long"}]
    _assert_no_echo(res)


def test_too_many_lines_are_rejected(client: TestClient) -> None:
    line = {"id": "l", "text": "You must pay.", "source_sentence_id": "s1", "symbol_id": None}
    res = client.post("/check", json={"original": "x", "key_facts": [], "lines": [line] * (MAX_LINES + 1)})
    assert res.status_code == 422
    assert res.json()["detail"][0]["type"] == "too_long"


def test_overlong_line_text_is_rejected(client: TestClient) -> None:
    line = {"id": "l1", "text": SECRET + "a" * MAX_LINE_CHARS, "source_sentence_id": "s1", "symbol_id": None}
    res = client.post("/check", json={"original": "x", "key_facts": [], "lines": [line]})
    assert res.status_code == 422
    _assert_no_echo(res)


def test_oversized_body_gets_413(client: TestClient) -> None:
    res = client.post(
        "/analyse",
        content=b'{"original": "' + b"a" * (MAX_BODY_BYTES + 1) + b'"}',
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 413
    assert "a" * 100 not in res.text


def test_overlong_symbol_query_is_rejected(client: TestClient) -> None:
    res = client.get("/symbols", params={"q": SECRET + "a" * MAX_SYMBOL_QUERY_CHARS})
    assert res.status_code == 422
    _assert_no_echo(res)


# --- logging -----------------------------------------------------------------


def test_access_log_filter_strips_query_string() -> None:
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 0, '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:5000", "GET", "/symbols?q=council+tax", "1.1", 200), None,
    )
    assert _StripQueryFilter().filter(record)
    assert "council" not in record.getMessage()
    assert "/symbols" in record.getMessage()


def test_access_log_filter_is_installed() -> None:
    assert any(isinstance(f, _StripQueryFilter) for f in logging.getLogger("uvicorn.access").filters)
