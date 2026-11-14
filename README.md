# Easy Read Engine

Easy Read Engine turns an official letter, such as a council tax notice, into Easy Read: short sentences, plain words and a picture for each line. It's for adults with learning disabilities, low literacy or English as a second language, and for the carers and support workers who read letters with them.

The app checks each Easy Read line against 10 fixed rules (P1 to P10) before you see it. The original letter stays on screen next to the Easy Read version, and the app highlights key facts such as dates, amounts and reference numbers in both. You can edit lines and export the result as a PDF.

**Try it:** [easyread.wendyji.com](https://easyread.wendyji.com). Entered in the Kiroween 2026 **Frankenstein** category.

## Access

Anyone can open the sample letters and export them as PDFs. These make no model call.

Live conversion calls a paid model, so it needs an access key. Hackathon judges get the key through the private Devpost form. On the input screen, select **I have an access key** and type it.

## How it is stitched together (Frankenstein)

The project joins language models with deterministic code. The models write the Easy Read lines, and the checker decides which lines reach the reader.

| Part | What it does |
| --- | --- |
| Language models | Rewrite the letter into Easy Read lines, judge meaning (P9) and tone and advice (P10), and read photos of letters. Amazon Bedrock first, Groq as the fallback |
| spaCy dependency parsing | Splits sentences, extracts key facts and runs P2 to P7. No model, so the same input always gives the same result |
| ARASAAC pictogram library | Gives each line a picture. P8 checks every picture ID against the committed index |
| NGSL word list | The New General Service List of common English words, used by P5 to find hard words |
| Hypothesis and fast-check property tests | Test the checker with generated letters with random dates, amounts and passive sentences, cases the checker must fail, and a mutation test that changes one fact and expects P1 to fail |
| Headless Chromium | Renders the print page to an A4 PDF |

## How it works

**The web app** (`web/`, Next.js) makes every model call and runs the convert, check and regenerate loop:

1. Extract the text (typed PDF with `pdfjs-dist`, photo with a vision model) and let the user confirm it.
2. Ask the checker for the sentences and key facts of the original.
3. Ask the rewrite model for Easy Read lines.
4. Ask the checker to run P1 to P8, and the judge model to run P9 and P10.
5. Regenerate the lines that failed, up to 3 tries in total. Then pass, flag or block the result.

**The checker** (`checker/`, Python with FastAPI and spaCy) owns sentence splitting, key-fact extraction, the P1 to P8 checks and the pictogram index. It is also an MCP server over stdio (`uv run python src/mcp_server.py`) with the tools `check_easy_read`, `extract_key_facts` and `find_symbol`.

Prompts are in `prompts/`, and the full design is in `.kiro/specs/easy-read/design.md`.

The checker gates the model in four ways:

- The checker takes key facts from the original before the model writes anything, so P1 compares the output with the original.
- If no try passes P1, or P1 fails after a user edit, the app blocks the output: it shows no lines, names the failed key fact and turns off export. If an earlier try passed P1, the app shows that try instead.
- If any other rule still fails after 3 tries, the app shows the output with that rule flagged.
- If the advice check (P10) could not run, the app turns off export. If the checker is down, the app shows nothing and returns a 503.

## Kiro setup

The `.kiro/` folder holds the spec, steering, hooks and MCP config used to build this project.

- **Spec.** `.kiro/specs/easy-read/` holds the requirements (in EARS form), the design and the tasks. Kiro worked through the tasks one at a time.
- **Steering.** `easy-read-rules.md` (the rules in plain language), `safety.md` (no advice, keep the original), `tech.md` and `ui.md`.
- **Hooks.**
  - Saving a file in `checker/src/checks/` runs that check's tests.
  - Saving a prompt in `prompts/` runs the 5 fixture letters through the full pipeline and all 10 checks, so a prompt change that breaks a rule shows up at once.
  - After a spec task is done, one hook fails if any property test was deleted or skipped. Another runs the tests and commits the task.
- **MCP servers.** `.kiro/settings/mcp.json` starts `easy-read-checker` from `checker/`, and two local development servers, `aws-mcp` and `aws-docs`.
- **Kiro Power.** `power-easy-read/` packages the checker and the Easy Read rules as a [Kiro Power](https://kiro.dev/docs/powers/create/). See `power-easy-read/README.md`.
- **Reviewer agent.** `.kiro/agents/easy-read-reviewer.md` is a read-only [custom agent](https://kiro.dev/docs/custom-agents/) that reviews Easy Read lines, fixtures and prompt changes with the checker tools.

## The rules

| Rule | What it checks | Checked by | Guidance |
| --- | --- | --- | --- |
| P1 | Every key fact (dates, times, amounts, reference numbers, phone numbers, addresses, required actions) appears unchanged | Checker | DH A1, IE 2.23 |
| P2 | No sentence is longer than 15 words | Checker | IE 2.19, DH A6 |
| P3 | One idea per sentence | Checker (approximate) | IE 2.19 |
| P4 | No passive voice | Checker | IE 1.17 |
| P5 | Plain words, or harder words explained on first use | Checker | IE 1.6, 1.7, DH A3 |
| P6 | Numbers are written as digits | Checker | IE 2.42, DH A4 |
| P7 | Abbreviations are explained on first use | Checker | IE 1.12, 2.16, DH A3 |
| P8 | Every picture has a real ID from the pictogram index | Checker | IE 2.34–2.38, DH A2 |
| P9 | Each line keeps the meaning of its source sentence | Judge model | |
| P10 | The tone is respectful, not childish, and gives no advice | Judge model | IE 1.3 |

The guidance references are to Inclusion Europe, [Information for all](https://www.inclusion-europe.eu/wp-content/uploads/2017/06/EN_Information_for_all.pdf) (IE, section.standard), and the Department of Health, [Making written information easier to understand](https://www.gov.uk/government/publications/making-written-information-easier-to-understand-for-people-with-learning-disabilities-guidance-for-people-who-commission-or-produce-easy-read-information-revised-edition-2010) (DH, Annex A section). The guides give advice. We chose to turn that advice into pass or fail rules, and we also chose the exact limits, the unchanged-facts part of P1, the pictogram index check in P8 and the no-advice part of P10.

The guides also set layout rules. The PDF follows them: Arial at 18pt, left-aligned, pictures to the left and dark text on a light background. The result screen breaks one of them ("Do not write in columns", IE 2.27) on purpose: it shows the original next to the Easy Read version so you can check one against the other.

## Safety

- **The app does not store or log letter text.** Logs hold only rule results, attempt counts, timings and which model answered.
- **The original letter is the official one.** Every result and exported PDF says the Easy Read version is a simplified copy.
- **No advice.** The P10 judge checks each line for advice.
- The app sends letter text to an outside AI provider. It tells users this and asks them not to upload letters with personal details.

## Prior art

Swindon Borough Council's [Simply Readable](https://www.local.gov.uk/case-studies/swindon-borough-council-simply-readable-ai-easy-read-solution) also makes Easy Read with AI, for council staff. Its case study describes no automated checks on the output. Easy Read Engine serves the person who got the letter and checks each line.

## Run it locally

You need [uv](https://docs.astral.sh/uv/) (Python 3.13), Node.js 20 or later, and Docker if you want to use Docker Compose.

1. Copy `.env.example` to `.env` and add your API keys. Never commit `.env`.
2. `cd checker && uv sync`
3. `cd web && npm install`

```sh
cd checker && uv run uvicorn http_app:app --app-dir src   # checker on port 8000
cd web && npm run dev                                     # web app on port 3000, in a second terminal
```

`CHECKER_URL` in `.env` tells the web app where the checker is (`http://localhost:8000` by default). To run both in Docker instead, use `docker compose up --build`. Compose publishes the web app on `localhost:3000`, and the web app reaches the checker as `http://checker:8000`.

Set the access key in `ACCESS_KEY`. If you leave it empty, development opens every route and every other environment closes live conversion.

## Tests and scripts

| Command | What it does |
| --- | --- |
| `cd checker && uv run pytest` | Checker unit tests and Hypothesis property tests (no model) |
| `cd checker && uv run pytest -m needs_model` | Pipeline property test against the running web app and a live model |
| `cd web && npm test` | Vitest and fast-check tests for the web app |
| `cd web && npm run fixtures` | Runs the fixture letters through the full pipeline and all 10 checks |
| `cd web && npm run record-samples` | Records the public sample letters into `web/data/samples/` |
| `cd web && npm run gen:checker-types` | Regenerates `web/src/types/checker.ts` from the checker's OpenAPI schema |

`fixtures`, `record-samples` and `needs_model` call real model providers and cost money. Start the checker first.

## Model providers

Each role has an ordered list of `provider:model` entries in `.env` (`MODEL_REWRITE`, `MODEL_JUDGE`, `MODEL_VISION`). The client moves to the next entry after a rate-limit error, a server error, a 401, 403 or 404, or a timeout.

| Role | First (Bedrock, `eu-west-2`) | Fallback (Groq) |
| --- | --- | --- |
| Rewrite and regenerate | `openai.gpt-oss-120b-1:0` | `openai/gpt-oss-120b` |
| Judge (P9, P10) | `qwen.qwen3-235b-a22b-2507-v1:0` | `qwen/qwen3.8-27b` |
| Vision (photos) | `qwen.qwen3-vl-235b-a22b` | `qwen/qwen3.8-27b` |

The web app calls Bedrock through its OpenAI-compatible [Chat Completions API](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html) with a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK`. It uses no cross-Region inference profile, so letter text stays in London. Groq is the free-plan fallback and has tight [rate limits](https://console.groq.com/docs/rate-limits).

## Licences

- **Code:** MIT. See [LICENSE](LICENSE).
- **Pictograms:** Sergio Palao. Origin: ARASAAC (https://arasaac.org). Licence: CC BY-NC-SA. Owner: Government of Aragón (Spain). See `checker/data/LICENSE-pictograms.md`. You can't use the pictograms commercially without the owner's permission.
- **Word list:** the New General Service List (NGSL), used by P5, is CC BY-SA 4.0. See `checker/src/checks/wordlist/README.md`.
