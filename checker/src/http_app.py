"""HTTP adapter for the checker functions (design "Checker service").

A thin FastAPI layer over `checks`: each route validates its input with
Pydantic and calls one public function. Letter text is never logged or stored
(R7.4):

- request bodies are never logged, and error responses never echo them back
  (validation errors return field locations and error types only);
- the uvicorn access log has query strings removed, because `/symbols?q=`
  carries words from Easy Read lines;
- unhandled errors are logged by exception type and route path only.

Run from `checker/`:

    uv run uvicorn http_app:app --app-dir src
"""

import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, MutableMapping
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

import checks
from checks.config import (
    MAX_ID_CHARS,
    MAX_KEY_FACTS,
    MAX_LINE_CHARS,
    MAX_LINES,
    MAX_ORIGINAL_CHARS,
    MAX_SYMBOL_LIMIT,
    MAX_SYMBOL_QUERY_CHARS,
    SPACY_MODEL,
)
from checks.models import ActionSynonym, Analysis, CheckResult, KeyFact, Line, SymbolMatch
from checks.p8_symbols import symbol_ids
from checks.symbols import search_index
from checks.sentences import get_nlp

logger = logging.getLogger("checker.http")

# Largest request body accepted, in bytes. A /check body holds the Original,
# its key facts and every line, each bounded below; this leaves room for JSON
# escaping on top of those bounds.
MAX_BODY_BYTES = 2_000_000

Original = Annotated[str, Field(max_length=MAX_ORIGINAL_CHARS)]


# --- request and response bodies ---------------------------------------------


class AnalyseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    original: Original


class KeyFactsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Original


class CheckRequest(BaseModel):
    """`key_facts` must come from the Original (`/analyse` or `/key-facts`),
    never from the output, so P1 compares the output with the Original (R2.4)."""

    model_config = ConfigDict(extra="forbid")

    original: Original
    key_facts: Annotated[list[KeyFact], Field(max_length=MAX_KEY_FACTS)]
    lines: Annotated[list[Line], Field(max_length=MAX_LINES)]

    @model_validator(mode="after")
    def _bound_nested_sizes(self) -> "CheckRequest":
        # `Line` and `KeyFact` are shared models with no size limits of their
        # own, so the bounds for this route are applied here.
        for line in self.lines:
            if len(line.text) > MAX_LINE_CHARS:
                raise ValueError("line text too long")
            ids = [line.id, line.source_sentence_id, line.symbol_id or ""]
            if any(len(i) > MAX_ID_CHARS for i in ids):
                raise ValueError("line ID too long")
        for fact in self.key_facts:
            if len(fact.value) > MAX_ORIGINAL_CHARS or len(fact.normalised) > MAX_ORIGINAL_CHARS:
                raise ValueError("key fact too long")
            if len(fact.id) > MAX_ID_CHARS or len(fact.sentence_id) > MAX_ID_CHARS:
                raise ValueError("key fact ID too long")
        return self


class Health(BaseModel):
    status: Literal["ok", "starting"]
    spacy_loaded: bool
    spacy_model: str
    symbol_index_loaded: bool


class ValidationIssue(BaseModel):
    """One invalid field: where it is and what kind of error it is. Never the
    submitted value or a message that could quote it."""

    loc: list[str | int]
    type: str


class ValidationErrorResponse(BaseModel):
    detail: list[ValidationIssue]


class ErrorResponse(BaseModel):
    detail: str


# --- logging and request guards ----------------------------------------------


class _StripQueryFilter(logging.Filter):
    """Remove the query string from uvicorn access log lines."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # uvicorn.access args: (client_addr, method, full_path, http_version, status_code)
        if isinstance(args, tuple) and len(args) == 5 and isinstance(args[2], str):
            record.args = (args[0], args[1], args[2].split("?", 1)[0], args[3], args[4])
        return True


_access_logger = logging.getLogger("uvicorn.access")
if not any(isinstance(f, _StripQueryFilter) for f in _access_logger.filters):
    _access_logger.addFilter(_StripQueryFilter())


class _BodyTooLarge(Exception):
    pass


Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]


async def _send_json(send: Send, status: int, body: dict[str, Any]) -> None:
    payload = json.dumps(body).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": payload})


class _SafeBoundary:
    """Outer ASGI guard: reject bodies over `MAX_BODY_BYTES` with 413, and turn
    any unhandled error into a plain 500 so no traceback or exception message
    (which could quote letter text) reaches the logs or the client."""

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        length = dict(scope.get("headers", [])).get(b"content-length")
        if length is not None:
            try:
                too_large = int(length) > MAX_BODY_BYTES
            except ValueError:
                await _send_json(send, 400, {"detail": "invalid content-length"})
                return
            if too_large:
                await _send_json(send, 413, {"detail": "request body too large"})
                return

        received = 0
        started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_BODY_BYTES:
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if not started:
                await _send_json(send, 413, {"detail": "request body too large"})
        except Exception as exc:  # noqa: BLE001 - the boundary must catch everything
            logger.error("unhandled %s on %s %s", type(exc).__name__, scope.get("method"), scope.get("path"))
            if not started:
                await _send_json(send, 500, {"detail": "internal error"})


# --- app ---------------------------------------------------------------------


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Load the spaCy model and the symbol index once, before serving.
    get_nlp()
    symbol_ids()
    search_index()
    yield


app = FastAPI(
    title="Easy Read checker",
    version="0.1.0",
    description="Deterministic Easy Read checks: sentences, key facts, P1 to P8 and the symbol index.",
    lifespan=_lifespan,
)
app.add_middleware(_SafeBoundary)

_VALIDATION_RESPONSES: dict[int | str, dict[str, Any]] = {
    422: {"model": ValidationErrorResponse, "description": "Invalid request"},
    413: {"model": ErrorResponse, "description": "Request body too large"},
}


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    # FastAPI's default handler returns each error's `input` and `msg`, which
    # can contain the submitted letter text. Return locations and types only.
    issues = [
        {"loc": [p for p in err.get("loc", ()) if isinstance(p, str | int)], "type": str(err.get("type", ""))}
        for err in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": issues})


@app.post("/analyse", response_model=Analysis, responses=_VALIDATION_RESPONSES)
def analyse(body: AnalyseRequest) -> Analysis:
    """Sentences of the Original, with spans, and its key facts."""
    return checks.analyse(body.original)


@app.post("/key-facts", response_model=list[KeyFact], responses=_VALIDATION_RESPONSES)
def key_facts(body: KeyFactsRequest) -> list[KeyFact]:
    """Key facts in `text`, with spans and normalised values."""
    return checks.extract_key_facts(body.text)


@app.post("/check", response_model=list[CheckResult], responses=_VALIDATION_RESPONSES)
def check(body: CheckRequest) -> list[CheckResult]:
    """P1 to P8 for the lines, in rule order, one result per rule."""
    return checks.check_easy_read(body.original, body.key_facts, body.lines)


@app.get("/symbols", response_model=list[SymbolMatch], responses=_VALIDATION_RESPONSES)
def symbols(
    q: Annotated[str, Query(min_length=1, max_length=MAX_SYMBOL_QUERY_CHARS)],
    limit: Annotated[int, Query(ge=1, le=MAX_SYMBOL_LIMIT)] = 5,
) -> list[SymbolMatch]:
    """Pictograms for `q`, best first."""
    return checks.find_symbol(q, limit)


@app.get("/config/action-synonyms", response_model=list[ActionSynonym])
def action_synonyms() -> list[ActionSynonym]:
    """The verb swaps P1 accepts in required actions, for the rule report.

    `checks/config.py` is the only copy; the web app shows this list as is.
    """
    return checks.action_synonyms()


@app.get("/health", response_model=Health, responses={503: {"model": Health}})
def health() -> JSONResponse:
    """Ready when the spaCy model and the symbol index are loaded."""
    spacy_loaded = get_nlp.cache_info().currsize > 0
    index_loaded = symbol_ids.cache_info().currsize > 0
    ready = spacy_loaded and index_loaded
    body = Health(
        status="ok" if ready else "starting",
        spacy_loaded=spacy_loaded,
        spacy_model=SPACY_MODEL,
        symbol_index_loaded=index_loaded,
    )
    return JSONResponse(status_code=200 if ready else 503, content=body.model_dump())
