---
inclusion: always
---

# Tech

Full detail is in `.kiro/specs/easy-read/design.md`.

## Stack

| Part | Choice |
| --- | --- |
| Web app and API | Next.js 16 App Router, TypeScript, route handlers with `runtime = "nodejs"`. No separate Node backend |
| UI | Tailwind CSS 4 and shadcn/ui (style `radix-nova`, Lucide icons). See `ui.md` |
| Validation | zod at every route boundary |
| Web tests | Vitest and fast-check |
| Checker service | Python 3.13 managed with uv. FastAPI, Pydantic, spaCy with pinned `en_core_web_sm` 3.8.0 |
| Checker tests | pytest and Hypothesis |
| MCP server | Official Python `mcp` SDK (FastMCP), stdio, local only |
| Models | OpenAI-compatible client. Groq first, OpenRouter free models as fallback, Gemini in development only |
| Text extraction | `pdfjs-dist` for typed PDFs, a vision model for photos |
| PDF export | Print page rendered in headless Chromium |
| Pictograms | ARASAAC (CC BY-NC-SA), index committed at `checker/data/symbols.json` |
| Hosting | Docker Compose on a Hetzner VPS via Dokploy |

Ownership:

- The web app makes every model call and runs the convert, check and regenerate loop.
- The checker service is model-free. It owns sentence splitting, key-fact extraction, P1 to P8 and the symbol index, so its tests are deterministic.
- TypeScript types for checker data come from the FastAPI OpenAPI schema (`web/src/types/checker.ts`, generated with `openapi-typescript`). Don't edit them by hand.

This Next.js version has breaking changes. Read `web/AGENTS.md` and the guides in `web/node_modules/next/dist/docs/` before writing Next.js code.

## Folder layout

```
web/                         Next.js app
  app/                       pages and api/*/route.ts handlers
  components/ui/             shadcn/ui components
  lib/                       shared helpers (shadcn utils)
  src/
    pipeline/                orchestrator, retry loop, block/flag decision
    llm/                     model client, rewrite, vision, judges
    checker-client/          typed HTTP client for the checker service
    types/checker.ts         generated from the checker OpenAPI schema
  tests/                     fast-check and unit tests
prompts/                     rewrite, regenerate, vision and judge prompts
checker/                     Python service (uv project)
  src/checks/                sentences, key facts, p1_*.py to p8_*.py, symbols, wordlist/
  src/http_app.py            FastAPI adapter
  src/mcp_server.py          MCP adapter
  tests/                     Hypothesis properties, checker-must-fail cases, mutation test
fixtures/letters/            public sample and invented letters, no real personal data
docs/                        brief and recorded results
```

Each checker has its own file in `checker/src/checks/` and its own test file, `checker/tests/test_<checker>.py`.

## Commands

| Command | Runs |
| --- | --- |
| `cd checker && uv run pytest` | All Hypothesis and checker tests |
| `cd checker && uv run pytest tests/test_p2_sentence_length.py` | One checker (used by the on-save hook) |
| `cd checker && uv run uvicorn http_app:app --app-dir src` | Checker HTTP service on port 8000 |
| `cd web && npm run gen:checker-types` | Export the checker OpenAPI schema and regenerate `web/src/types/checker.ts` |
| `cd web && npx vitest --run` | fast-check and unit tests (also `npm test`) |
| `cd web && npm run fixtures` | 5 fixture letters through the full pipeline, all 10 checks |

- Always run Vitest with `--run`, so it exits.
- `uv run` uses the project's `.venv`. Plain `pytest` works only with that venv active.
- Never skip, xfail or delete a property test to make a run pass.

## Environment

Variables are listed in `.env.example`: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` (development only), `MODEL_REWRITE`, `MODEL_JUDGE`, `MODEL_VISION`, `CHECKER_URL`, `APP_ENV`. Never commit `.env`.
