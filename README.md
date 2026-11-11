# Easy Read Engine

## What it does

Easy Read Engine turns an official letter, such as a council tax notice, into Easy Read: short sentences, plain words and a picture for each line. You paste the text, upload a typed PDF or take a photo of the letter.

Every Easy Read line is checked against a fixed set of rules (P1 to P10) before you see it. The original letter stays on screen next to the Easy Read version, and key facts such as dates, amounts and reference numbers are highlighted in both. You can edit lines and export the result as a PDF.

## Setup

You need:

- [uv](https://docs.astral.sh/uv/) for the Python checker service (Python 3.13)
- Node.js 20 or later and npm for the web app
- Docker, if you want to run the full stack with Docker Compose

Then:

1. Copy `.env.example` to `.env` and add your API keys. `.env` is gitignored. Never commit it.
2. Install the checker: `cd checker && uv sync`
3. Install the web app: `cd web && npm install`

## Run it locally

Start the checker service on port 8000:

```sh
cd checker && uv run uvicorn http_app:app --app-dir src
```

In a second terminal, start the web app on port 3000:

```sh
cd web && npm run dev
```

`CHECKER_URL` in `.env` tells the web app where the checker is (`http://localhost:8000` by default).

To run both services in Docker instead:

```sh
docker compose up --build
```

`docker-compose.override.yml` publishes the web app on `localhost:3000`. The checker has no published port. The web app reaches it as `http://checker:8000`.

## Tests and scripts

| Command | What it does |
| --- | --- |
| `cd checker && uv run pytest` | Checker unit tests and Hypothesis property tests. Tests that need a live model are left out |
| `cd checker && uv run pytest -m needs_model` | The pipeline property test. It calls the running web app and a live model |
| `cd web && npm run fixtures:property` | Same as the line above, run from `web/` |
| `cd web && npm test` | Vitest and fast-check tests for the web app (`vitest --run`) |
| `cd web && npm run fixtures` | Runs the fixture letters through the full pipeline and all 10 checks |
| `cd web && npm run spike` | Day 1 spike: compares rewrite models on the fixture letters (P1, P2 and P4 pass counts, tokens, time), and checks vision and the ARASAAC endpoint |
| `cd web && npm run record-samples` | Records the public sample letters shown on the input screen, into `web/data/samples/` |
| `cd web && npm run gen:checker-types` | Exports the checker's OpenAPI schema and regenerates `web/src/types/checker.ts` |

The `fixtures`, `spike`, `record-samples` and `needs_model` commands call real model providers and use free-tier quota. Start the checker first.

## How it works

There are two services.

**The web app** (`web/`, Next.js) makes every model call. It runs the convert, check and regenerate loop:

1. Extract the text (typed PDF with `pdfjs-dist`, photo with a vision model) and let the user confirm it.
2. Ask the checker for the sentences and key facts of the original.
3. Ask the rewrite model for Easy Read lines.
4. Ask the checker to run P1 to P8, and the judge model to run P9 and P10.
5. Regenerate the lines that failed, up to 3 tries in total. Then pass, flag or block the result.

**The checker** (`checker/`, Python with FastAPI and spaCy) is model-free, so its results are repeatable. It owns sentence splitting, key-fact extraction, the P1 to P8 checks and the pictogram index. The same checks are also available as an MCP server over stdio (`uv run python src/mcp_server.py`) with the tools `check_easy_read`, `extract_key_facts` and `find_symbol`. Kiro starts it from `.kiro/settings/mcp.json`.

The prompts are in `prompts/`. The full design is in `.kiro/specs/easy-read/design.md`.

## The rules

| Rule | What it checks | Checked by |
| --- | --- | --- |
| P1 | Every key fact in the original (dates, times, amounts, reference numbers, phone numbers, addresses, required actions) appears unchanged in the output | Checker |
| P2 | No sentence is longer than 15 words | Checker |
| P3 | One idea per sentence | Checker (approximate) |
| P4 | No passive voice | Checker |
| P5 | Plain words, or harder words explained on first use | Checker |
| P6 | Numbers are written as digits | Checker |
| P7 | Abbreviations are explained on first use | Checker |
| P8 | Every picture has a real ID from the pictogram index | Checker |
| P9 | Each line keeps the meaning of its source sentence | Judge model |
| P10 | The tone is respectful, not childish, and gives no advice | Judge model |

The thresholds are starting values to tune against real Easy Read documents. They aren't published limits.

## Model providers and free limits

The app uses free tiers only. Each role (rewrite, judge, vision) has an ordered list of `provider:model` entries in `.env` (`MODEL_REWRITE`, `MODEL_JUDGE`, `MODEL_VISION`). The client moves to the next entry after a rate-limit error, a server error or a timeout. Each result records which provider and model answered.

Limits as checked on 11 November 2026:

- **Groq** (first choice). The [Groq rate limits page](https://console.groq.com/docs/rate-limits) lists `openai/gpt-oss-120b` and `qwen/qwen3.8-27b` at 30 requests a minute, 1,000 requests a day, 8,000 tokens a minute and 200,000 tokens a day each. Limits apply to the whole organisation. Your own limits page in the Groq console shows the exact figures for your account.
- **OpenRouter** (fallback). The [OpenRouter limits page](https://openrouter.ai/docs/api/reference/limits) says models ending in `:free` allow 20 requests a minute. The daily limit is 50 requests if you have bought less than 10 credits, and 1,000 if you have bought at least 10.
- **Gemini** (development only). Google's terms allow only paid services for apps offered to users in the UK, so production rejects any `gemini:` entry at start-up.

Free tiers change often. Check these pages again before relying on them.

## Easy Read guidance

Which official Easy Read guidance these rules follow is still an open question.

> **TODO:** name the official Easy Read guidance and link it here and in `.kiro/steering/easy-read-rules.md`.

Until then, the rules come from the project spec only (`.kiro/specs/easy-read/requirements.md`, "Correctness Properties").

## Safety

- **No letter text is stored or logged.** Letters are processed in memory. Logs hold only rule results, attempt counts, timings and the provider and model that answered. The only stored data is the pictogram image cache.
- **The original letter is the official one.** It is shown next to every result, and every result and exported PDF says the Easy Read version is a simplified copy.
- **Key facts must match.** If a key fact from the original is missing or changed after 3 tries, or after an edit, the output is blocked: no lines are shown, the failed key fact is named and export is turned off.
- **No advice.** The output says what the letter says. It never tells the reader what to decide. The P10 judge checks every line for advice.
- Letter text is sent to an outside AI provider. The app tells users this and asks them not to upload letters with personal details.

## Licences

- **Code:** MIT. See [LICENSE](LICENSE).
- **Pictograms:** Pictograms: Sergio Palao. Origin: ARASAAC (https://arasaac.org). Licence: CC BY-NC-SA. Owner: Government of Aragón (Spain). See `checker/data/LICENSE-pictograms.md`. The licence is non-commercial, so the pictograms can't be used in a commercial product without permission from the owner, even though the code is MIT.
- **Word list:** the New General Service List (NGSL), used by the P5 plain-words check, is licensed CC BY-SA 4.0. See `checker/src/checks/wordlist/README.md`.

## Status and known limitations

- [docs/day1-results.md](docs/day1-results.md): day 1 spike results.
- [docs/pass-rates.md](docs/pass-rates.md): the fixture run is partial (8 letters). Groq returned rate-limit errors on 22 of 67 requests, every rewrite from the OpenRouter Nemotron fallback was invalid, and the OpenRouter judge fallback returned 404.
- No sample letters are recorded yet, because the providers failed during recording. The sample list on the input screen is hidden until `npm run record-samples` succeeds.
- [docs/deploy.md](docs/deploy.md): the Chromium sandbox is turned off for PDF export in the container. The live deploy is still pending.
