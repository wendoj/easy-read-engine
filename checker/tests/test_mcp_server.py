"""Spawns `src/mcp_server.py` over stdio with the MCP SDK's client, as Kiro does.

All text here is invented. No real letters or personal data.
"""

import json
import sys
from pathlib import Path
from typing import Any

import anyio
import pytest
from mcp import Client
from mcp.client.stdio import StdioServerParameters

import checks
from checks.config import MAX_ORIGINAL_CHARS
from checks.models import CheckResult, KeyFact, Line, SymbolMatch

CHECKER_DIR = Path(__file__).resolve().parents[1]
RULES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]
TOOLS = {"check_easy_read", "extract_key_facts", "find_symbol"}

ORIGINAL = (
    "Your council tax payment of £45 was not received. "
    "You must pay £45 by 1 April 2026. "
    "Please call 0300 123 4567 if you have questions."
)
# A marker that must never come back in an error result.
SECRET = "Marigold Avenue 9Z7 ZZZ"


def _lines() -> list[dict[str, Any]]:
    return [
        {"id": "l1", "text": "The council did not get your payment of £45.", "source_sentence_id": "s1", "symbol_id": None},
        {"id": "l2", "text": "You must pay £45 by 1 April 2026.", "source_sentence_id": "s2", "symbol_id": None},
        {"id": "l3", "text": "You can phone 0300 123 4567 with questions.", "source_sentence_id": "s3", "symbol_id": None},
    ]


def _payload(result: Any) -> Any:
    """The tool's return value: structured content if present, else the JSON text."""
    assert result.is_error is False
    if result.structured_content is not None:
        return result.structured_content["result"]
    return json.loads(result.content[0].text)


async def _session() -> dict[str, Any]:
    server = StdioServerParameters(command=sys.executable, args=["src/mcp_server.py"], cwd=str(CHECKER_DIR))
    out: dict[str, Any] = {}
    with anyio.fail_after(120):
        async with Client(server) as client:
            out["tools"] = (await client.list_tools()).tools
            out["key_facts"] = await client.call_tool("extract_key_facts", {"text": ORIGINAL})
            facts = _payload(out["key_facts"])
            out["check"] = await client.call_tool(
                "check_easy_read", {"original": ORIGINAL, "key_facts": facts, "lines": _lines()}
            )
            out["symbols"] = await client.call_tool("find_symbol", {"query": "pay", "limit": 3})
            out["too_long_original"] = await client.call_tool(
                "extract_key_facts", {"text": "a" * (MAX_ORIGINAL_CHARS + 1)}
            )
            long_line = {**_lines()[0], "text": SECRET + " x" * 600}
            out["too_long_line"] = await client.call_tool(
                "check_easy_read", {"original": ORIGINAL, "key_facts": facts, "lines": [long_line]}
            )
            out["bad_limit"] = await client.call_tool("find_symbol", {"query": "pay", "limit": 0})
    return out


@pytest.fixture(scope="module")
def session() -> dict[str, Any]:
    return anyio.run(_session)


def test_lists_the_three_tools(session: dict[str, Any]) -> None:
    assert {t.name for t in session["tools"]} == TOOLS


def test_extract_key_facts_matches_the_shared_function(session: dict[str, Any]) -> None:
    facts = [KeyFact.model_validate(f) for f in _payload(session["key_facts"])]
    assert facts == checks.extract_key_facts(ORIGINAL)
    assert {"money", "date", "phone"} <= {f.type for f in facts}


def test_check_easy_read_returns_p1_to_p8(session: dict[str, Any]) -> None:
    results = [CheckResult.model_validate(r) for r in _payload(session["check"])]
    assert [r.rule for r in results] == RULES
    # Same function as POST /check, so the same results as calling it directly.
    facts = checks.extract_key_facts(ORIGINAL)
    lines = [Line.model_validate(line) for line in _lines()]
    assert results == checks.check_easy_read(ORIGINAL, facts, lines)


def test_find_symbol_returns_a_list(session: dict[str, Any]) -> None:
    matches = [SymbolMatch.model_validate(m) for m in _payload(session["symbols"])]
    assert matches and matches == checks.find_symbol("pay", 3)


@pytest.mark.parametrize("call", ["too_long_original", "too_long_line", "bad_limit"])
def test_out_of_bounds_inputs_are_rejected(session: dict[str, Any], call: str) -> None:
    result = session[call]
    assert result.is_error is True
    text = " ".join(getattr(c, "text", "") for c in result.content)
    assert SECRET not in text
