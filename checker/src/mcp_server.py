"""MCP adapter for the checker functions (design "Checker service").

A thin layer over `checks`, served over stdio with the official MCP SDK
(`MCPServer`, the mcp 2.x name for FastMCP). Each tool calls the same public
function as the matching HTTP route in `http_app.py` and applies the same
input bounds from `checks.config`. MCP returns P1 to P8 only; P9 and P10 need
a model and live in the web app.

| Tool                | HTTP route        | Function                   |
| ------------------- | ----------------- | -------------------------- |
| `check_easy_read`   | `POST /check`     | `checks.check_easy_read`   |
| `extract_key_facts` | `POST /key-facts` | `checks.extract_key_facts` |
| `find_symbol`       | `GET /symbols`    | `checks.find_symbol`       |

Letter text is never logged or stored (R7.4). stdout is the MCP channel, so
nothing else may write to it: start-up output is sent to stderr, the SDK logs
to stderr at WARNING and above, and errors raised to the client name field
locations and exception types only, never input values.

Run from `checker/`:

    uv run python src/mcp_server.py
"""

import contextlib
import sys
from typing import Annotated

from pydantic import Field, ValidationError

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

import checks
from checks.config import (
    MAX_KEY_FACTS,
    MAX_LINES,
    MAX_ORIGINAL_CHARS,
    MAX_SYMBOL_LIMIT,
    MAX_SYMBOL_QUERY_CHARS,
)
from checks.models import CheckResult, KeyFact, Line, SymbolMatch
from checks.p8_symbols import symbol_ids
from checks.symbols import search_index
from checks.sentences import get_nlp
from http_app import CheckRequest

Original = Annotated[str, Field(max_length=MAX_ORIGINAL_CHARS)]

mcp = MCPServer(
    name="easy-read-checker",
    version="0.1.0",
    instructions=(
        "Deterministic Easy Read checks. Call extract_key_facts on the Original first, "
        "then pass those key facts to check_easy_read with the Easy Read lines. "
        "Returns P1 to P8 only; P9 and P10 need a model and run in the web app."
    ),
    # INFO would log each tool failure message; WARNING keeps logs to start-up
    # problems and crashes, which are logged by type only (see `_safe_errors`).
    log_level="WARNING",
)


@contextlib.contextmanager
def _safe_errors():
    """Turn any failure into a `ToolError` that carries no input text.

    `from None` drops the cause, so neither the SDK's log line nor the result
    sent to the client can quote a pydantic `input_value` or an exception
    message built from the letter.
    """
    try:
        yield
    except ValidationError as exc:
        locs = sorted({".".join(str(p) for p in err["loc"]) or "<root>" for err in exc.errors()})
        types = sorted({err["type"] for err in exc.errors()})
        raise ToolError(f"invalid arguments at {locs}: {types}") from None
    except ToolError:
        raise
    except Exception as exc:  # noqa: BLE001 - the boundary must catch everything
        raise ToolError(f"internal error ({type(exc).__name__})") from None


@mcp.tool()
def check_easy_read(
    original: Original,
    key_facts: Annotated[list[KeyFact], Field(max_length=MAX_KEY_FACTS)],
    lines: Annotated[list[Line], Field(max_length=MAX_LINES)],
) -> list[CheckResult]:
    """Run P1 to P8 on Easy Read lines. Returns one result per rule, in rule order.

    `key_facts` must come from the Original (`extract_key_facts`), never from
    the output, so P1 compares the output with the Original.
    """
    with _safe_errors():
        # Same nested bounds (line length, ID length, key-fact size) as POST /check.
        body = CheckRequest(original=original, key_facts=key_facts, lines=lines)
        return checks.check_easy_read(body.original, body.key_facts, body.lines)


@mcp.tool()
def extract_key_facts(text: Original) -> list[KeyFact]:
    """Key facts in `text` (dates, times, money, references, phones, addresses,
    required actions), with character spans and normalised values."""
    with _safe_errors():
        return checks.extract_key_facts(text)


@mcp.tool()
def find_symbol(
    query: Annotated[str, Field(min_length=1, max_length=MAX_SYMBOL_QUERY_CHARS)],
    limit: Annotated[int, Field(ge=1, le=MAX_SYMBOL_LIMIT)] = 5,
) -> list[SymbolMatch]:
    """Pictograms from the symbol index for `query`, best first, at most `limit`.
    An empty list means no picture fits, so use none."""
    with _safe_errors():
        return checks.find_symbol(query, limit)


def main() -> None:
    # Load the spaCy model and the symbol index once, before serving. Anything
    # they print goes to stderr so it can't corrupt the stdio channel.
    with contextlib.redirect_stdout(sys.stderr):
        get_nlp()
        symbol_ids()
        search_index()
    mcp.run("stdio")


if __name__ == "__main__":
    main()
