# Implementation Plan

## Overview

Requirement numbers refer to `requirements.md`, properties P1 to P10 to its Correctness Properties, and section names to `design.md`.

## Tasks

### Setup and go/no-go

- [x] 1. Scaffold the repository
  - Create the folder layout from design "Folder layout": `web/`, `checker/`, `prompts/`, `fixtures/letters/`
  - `checker/`: Python project managed with uv (`pyproject.toml`), dependencies FastAPI, Pydantic, spaCy with a pinned `en_core_web_sm` version, `mcp`, pytest and Hypothesis
  - `web/`: Next.js App Router app in TypeScript, with Tailwind CSS, zod, Vitest and fast-check; run `npx shadcn@latest init` and add the components listed in design "UI"
  - Add `.env.example` listing `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` (development only), `MODEL_REWRITE`, `MODEL_JUDGE`, `MODEL_VISION`, `CHECKER_URL` and `APP_ENV`, plus a `.gitignore` that excludes `.env`
  - Confirm `cd checker && pytest` and `cd web && npx vitest --run` both run, with no tests yet
  - _Requirements: none directly; supports all

- [x] 2. Write the steering documents
  - `.kiro/steering/easy-read-rules.md`: the Easy Read rules in plain language, matching P2 to P8 and the P10 rubric (respectful tone, no advice)
  - `.kiro/steering/safety.md`: never give advice, always keep and show the original, flag numbers, never log letter text
  - `.kiro/steering/tech.md`: stack, folder layout and the test commands from design "Commands"
  - `.kiro/steering/ui.md`: use shadcn/ui components, no eyebrow headlines, short copy with no helper text that repeats a label or button
  - Leave a placeholder for the official Easy Read guidance source, which is still an open question
  - _Requirements: 3.1, 7.2, 7.3, 7.4_

- [x] 3. Define the checker data models and sentence splitting
  - Pydantic models `Sentence`, `KeyFact`, `Line` and `CheckResult` from design "Data Models"
  - `checks/sentences.py`: split the Original into sentences with IDs and character offsets using spaCy, loaded once
  - Hypothesis property: for any generated text, the sentence spans are in order, don't overlap, and slicing the text by each span returns that sentence's text
  - _Requirements: 2.2, 5.2_

- [x] 4. Implement key-fact extraction and normalisation
  - `checks/key_facts.py`: detection and normalised values for date, time, money, reference, phone, address and action, following the table in design "Key-fact extraction and normalisation"
  - Version 1 actions: verb lemma, object lemmas, and any date or money inside the action; phrasal verbs kept as one lemma; a short synonym table kept in config
  - Hypothesis round-trip properties: a generated date, amount, reference or phone number placed in text is extracted with the same normalised value; different formats of the same value give the same normalised value
  - _Requirements: 2.1, 2.2, 2.6_

- [x] 5. Implement P1 and its tests
  - `checks/p1_key_facts.py`: extract facts from the output lines with the same extractor, compare normalised sets, and report failing line IDs and `failed_fact_ids` as in design "Checkers"
  - Hypothesis property: output that contains every fact unchanged passes P1
  - Mutation test: change one digit of one date or amount in a passing output, and P1 must fail and name that fact
  - Test that a missing fact fails and maps to the lines from that fact's source sentence
  - _Requirements: 2.3, 2.4, 2.5, 2.6; P1_

- [x] 6. Implement P2 and P4 and their tests
  - `checks/p2_sentence_length.py`: fail any sentence over 15 words, with the limit in config
  - `checks/p4_passive.py`: fail on `auxpass` or `nsubjpass`
  - Hypothesis properties: any generated sentence of 16 or more words fails P2, and any of 15 or fewer passes; generated passive sentences fail P4 and their active forms pass
  - Fixed checker-must-fail cases from the brief: a 16-word sentence fails P2, a passive sentence fails P4
  - _Requirements: 3.1; P2, P4_

- [x] 7. Build the model client with the provider chain
  - `web/src/llm/`: one OpenAI-compatible client for Groq, OpenRouter and Gemini, configured by `provider:model` env lists per role, as in design "Model provider"
  - Try entries in order and move on after a 429, a 5xx or a timeout; record which provider and model answered
  - Set `reasoning_effort: "low"` and a `max_tokens` cap for `gpt-oss-120b`, and turn off thinking mode for the Qwen judge
  - Start-up check: fail if `APP_ENV=production` and any `gemini:` entry is configured
  - fast-check properties: for any pattern of provider failures, entries are tried in order, nothing is called after a success, and no `gemini:` entry is called in production mode
  - _Requirements: 7.5 (supports); design "Model provider"_

- [x] 8. Write the spike script and record results
  - `fixtures/letters/`: add 3 public sample council letters (supplied by you) and 2 invented letters with no real personal data
  - First draft of `prompts/rewrite.md` using the steering rules
  - `web/scripts/spike.ts`: run each letter through each rewrite candidate; score the output with P1, P2 and P4 through a small CLI wrapper in `checker/`; record tokens per request and time taken
  - Check whether Groq's `qwen/qwen3.8-27b` accepts an image, and confirm which ARASAAC API endpoint returns the full English catalogue
  - Measure pictogram coverage: for each output line, search ARASAAC for a keyword and record whether a match comes back
  - Write the results to `docs/day1-results.md`: pass counts per model, tokens per request against the design's 4,000 and 3,000 estimates, Qwen vision result, ARASAAC endpoint, and coverage
  - _Requirements: supports the go/no-go decision; design Open Questions 1 and 2_

### Checkers

- [x] 9. Implement P3, P5, P6 and P7 with their tests
  - P3: count main verb clauses (`ROOT`, `conj` verbs on the root, and `ccomp`/`advcl` heads); fail if more than 1
  - P5: common-word list in `checks/wordlist/`; pass lemmas that are on the list, numbers, key-fact tokens, or defined on first use
  - P6: fail alphabetic `like_num` tokens
  - P7: fail all-caps tokens of 2 or more letters that aren't expanded on first use
  - For each checker: Hypothesis properties for passing and failing inputs, plus fixed checker-must-fail cases
  - _Requirements: 3.1; P3, P5, P6, P7_

- [x] 10. Build the ARASAAC pictogram index and P8
  - `checker/scripts/build_symbol_index.py`: fetch the English catalogue once using the endpoint confirmed in task 8; leave out pictograms flagged `violence` or `sex`; write `checker/data/symbols.json` in the format from design "Symbols"; commit the result
  - Add `checker/data/LICENSE-pictograms.md` stating the CC BY-NC-SA licence and the required attribution
  - `checks/p8_symbols.py`: every non-null `symbol_id` must exist in the index
  - Hypothesis property: IDs drawn from the index pass and IDs outside it fail
  - _Requirements: 4.3, 4.4; P8_

- [x] 11. Add `check_easy_read` and the synthetic letter generator
  - `checks/__init__.py`: public functions `analyse`, `extract_key_facts`, `check_easy_read` (P1 to P8) and `find_symbol` (a stub until task 23), as in design "Checker service"
  - Hypothesis strategy in `checker/tests/strategies.py`: synthetic letters with random dates, amounts, reference numbers, and long, passive sentences, kept for the pipeline property in task 30
  - Property: `check_easy_read` always returns exactly one result for each of P1 to P8
  - _Requirements: 3.1, 6.1_

- [x] 12. Build the FastAPI adapter and generated types
  - `checker/src/http_app.py` with routes `POST /analyse`, `POST /key-facts`, `POST /check`, `GET /symbols?q=` and `GET /health` (which reports whether spaCy is loaded)
  - Validate requests with Pydantic; never log request bodies
  - Script to export the OpenAPI schema and generate `web/src/types/checker.ts` with `openapi-typescript`
  - _Requirements: 3.1, 7.4_

- [x] 13. Build the MCP server
  - `checker/src/mcp_server.py` with the official Python MCP SDK over stdio, exposing tools `check_easy_read`, `extract_key_facts` and `find_symbol` that call the same functions as the HTTP routes
  - Add the local server entry to `.kiro/settings/mcp.json`
  - Make one sample call to each tool to confirm it responds
  - _Requirements: design "Checker service"_

### Pipeline

- [x] 14. Build the checker client
  - `web/src/checker-client/`: a typed `fetch` wrapper using the generated types, with the base URL from `CHECKER_URL`, a request timeout, and a `CheckerUnavailable` error
  - _Requirements: 3.1_

- [x] 15. Write the prompts and the model calls for rewrite, regenerate and judge
  - Prompt files in `prompts/`: `rewrite.md`, `regenerate.md`, `judge.md` (P9, P10 tone and P10 advice in one call) and `vision.md` (handwriting check, then text)
  - `rewrite` and `regenerate` return lines with `text`, `sourceSentenceId` and `symbolQuery`; `judge` returns, for each line, a verdict and a reason for meaning, tone and advice
  - Request JSON through a tool definition, validate it with zod, and retry once on invalid JSON
  - fast-check property: a line with a failed advice verdict always fails P10
  - _Requirements: 3.6, 7.2, 7.3; P9, P10_

- [x] 16. Build the pipeline orchestrator
  - `web/src/pipeline/`: `convert` with `MAX_ATTEMPTS = 3`, `failingLineIds` and `decide`, following the code in design "Pipeline orchestrator"
  - Map a missing fact to the lines from its source sentence, or ask the regenerate prompt to add a line when there are none
  - Return no lines when `status` is `"blocked"`, and always include the R7.1 notice
  - fast-check properties, using a fake model and a fake checker:
    - no more than 3 tries
    - P1 failing on the last try gives `"blocked"` and empty `lines`
    - other rules failing on the last try give `"flagged"`, with every failed rule in `checks`
    - regeneration changes only failing lines
    - `checks` always holds all 10 rules
    - at most 6 model requests, not counting JSON retries and fallbacks
  - _Requirements: 2.4, 2.5, 3.1 to 3.6, 6.1, 7.1_

- [x] 17. Build `/api/convert` with streaming, the letter length limit and rate limits
  - Route handler with `runtime = "nodejs"`; validate the body with zod; reject letters over 1,500 words with a 400 before any model call
  - Stream newline-delimited JSON: progress events, then the final `ConversionResult`
  - Per-IP token bucket and a global daily cap shared with `/api/extract` and `/api/check`, returning the messages in design "Error Handling"
  - Return 503 when the checker is unavailable or every provider in the chain fails
  - _Requirements: 1.6, 1.7, 3.1, 7.4_

- [x] 18. Build text extraction with `/api/extract`
  - Typed PDFs go through `pdfjs-dist`; a PDF with no text layer is treated as an image
  - Images go to the vision chain with `prompts/vision.md`; a handwritten page returns `error: "handwriting"`
  - Check file type and size before any model call
  - _Requirements: 1.2, 1.3, 1.4_

- [x] 19. Build the fixture script
  - `npm run fixtures`: convert the 5 fixture letters one at a time and run all 10 checks
  - For each letter, record pass or fail per rule, attempts, and the provider and model that answered; write a summary table to stdout and a JSON file to `fixtures/results/`
  - Add a `--all` flag for the 20-letter pass-rate run in task 31
  - _Requirements: 3.1, 6.1_

- [-] 20. Set up the three Kiro hooks
  - Create them with the hook tool, not by hand
  - On save in `checker/src/checks/`: run the matching test file for that checker
  - On save in `prompts/`: run `npm run fixtures`
  - After a task is marked done: fail if any property test is skipped, marked xfail, or deleted compared with the last commit. Kiro has no "before done" trigger, so this uses PostTaskExec
  - _Requirements: brief "Kiro setup"_

### Pictures and layout

- [~] 21. Build the input screen
  - `web/app/page.tsx`: paste box, file upload, and an editable confirm step with a word count against the 1,500-word limit
  - Show the R7.5 notice above the Convert button; show the handwriting message from R1.4
  - Show the progress events from the `/api/convert` stream
  - _Requirements: 1.1 to 1.7, 7.5_

- [~] 22. Build the side-by-side result screen
  - `web/app/result/page.tsx`: the Original on the left; Easy Read lines on the right, with a picture to the left of each line
  - Selecting a line highlights its source sentence using the spans from `analyse`
  - Show the safety notice at the top, with no way to dismiss it
  - _Requirements: 5.1, 5.2, 7.1_

- [~] 23. Implement pictogram search and the image cache
  - `find_symbol`: rank by lemma overlap with keywords, plurals and tags, with a bonus for an exact keyword match, and return a score
  - `attachSymbols` in the pipeline: take the top match only above the threshold, otherwise `null`
  - Route `web/app/symbols/[id]/route.ts`: fetch the PNG from ARASAAC on first use, cache it in the `symbol-cache` directory, and serve later requests from the cache
  - Show the ARASAAC attribution in the result screen footer
  - Hypothesis property: `find_symbol` returns only IDs that exist in the index
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

### Report and export

- [~] 24. Build the rule report and pass count
  - Pass count at the top ("10 of 10 checks passed"); selecting it opens the report panel
  - The report lists each rule, its result, the lines it applied to, and its reasons; it also lists the action synonym table used by P1
  - Flagged state: failed rules in red, with a marker on the affected lines
  - _Requirements: 3.4, 6.1, 6.2, 6.3_

- [~] 25. Highlight key facts in both columns
  - Use one colour per fact, matched across the Original and the Easy Read lines
  - _Requirements: 5.3_

- [~] 26. Build editing and `/api/check`
  - Each line gets an Edit button; on save, call `/api/check` with `editedLineIds`, and update the report, pass count and status
  - The server re-runs P1 to P8 on all lines and judges only the edited lines; it never changes the user's text
  - The client keeps the previous lines for "Undo edit"
  - fast-check properties: `/api/check` never changes the user's text, calls the judge only for edited lines, and returns `"blocked"` whenever P1 fails
  - _Requirements: 9.1 to 9.4_

- [~] 27. Build the blocked state
  - Show the Original, the failed key facts with their original values, and a message that the output was withheld
  - Offer "Undo edit" when the block came from an edit; disable Export
  - _Requirements: 2.5, 9.3, 9.5_

- [~] 28. Build the print layout and `/api/export`
  - `web/app/print/page.tsx`: A4, text of at least 16pt, picture column on the left, one line per row, the safety notice at the top of page 1, and the ARASAAC attribution and licence in the footer
  - `/api/export`: render the print page in headless Chromium and return the PDF; run up to 2 exports at once and queue the rest; return 409 when the result is blocked
  - _Requirements: 4.4, 7.1, 8.1, 8.2, 8.3, 9.5_

### Polish and evidence

- [~] 29. Add the recorded sample letters
  - Record results for the public sample letters, labelled with the date and the model that answered, and store them in `web/data/samples/`
  - Add a "Try a sample letter" list to the input screen; re-run P1 to P8 through the checker when a sample loads
  - _Requirements: 3.1; design "Protecting the live quota"_

- [x] 30. Add the pipeline property test
  - Use the strategy from task 11 to send synthetic letters through the full pipeline; every output must satisfy P1 to P8
  - Mark the test as needing a model, so it runs with the fixture job and not on every save
  - _Requirements: correctness properties, property-based testing items 1 and 2_

- [~] 31. Run the pass-rate measurement
  - Run `npm run fixtures -- --all` on the 20 public sample letters and save the results table to `docs/pass-rates.md`
  - _Requirements: none; evidence for the write-up_

- [~] 32. Containerise and deploy
  - `checker/Dockerfile`: Python slim image with the spaCy model installed at build time, and a health check on `/health`
  - `web/Dockerfile`: Next.js `output: "standalone"` with Chromium and its system libraries
  - `docker-compose.yml`:
    - `web` waits for `checker` to be healthy
    - the checker gets no domain and no published port
    - one `symbol-cache` volume
    - memory limits of 2 GB for `web` and 1 GB for `checker`
  - Deploy on Dokploy; point the DNS record for `easyread.wendyji.com` at the VPS before adding the domain; set the secrets as Dokploy environment variables
  - Smoke test on the live URL: convert a sample letter, export a PDF, and confirm the start-up check rejects a `gemini:` entry in production
  - _Requirements: 7.4; design "Deployment"_

### Ship

- [~] 33. Write the README and licence notes
  - Cover setup, test commands, the architecture summary, the model providers and their free limits, and the Easy Read guidance source
  - State that the code is MIT and the pictograms are CC BY-NC-SA, with the full ARASAAC attribution
  - Confirm `.kiro/` (specs, steering, hooks, MCP config) is committed
  - _Requirements: 4.4_

## Notes

- Every UI task (21 to 29) uses the shadcn components and copy rules in design "UI".
- Non-coding work (reviews, decisions, video, posts) is listed below, separate from the implementation tasks, so it is not mistaken for one.

### Non-coding checklist (you)

- [~] Provide 3 public sample council letters for `fixtures/letters/`
- [~] Show one output to someone who uses or makes Easy Read
- [~] **Go/no-go decision.** Go if at least 7 of the 10 properties are automatic and the output is judged usable; record it in `docs/day1-results.md`
- [~] Choose the official Easy Read guidance and add it to the steering doc
- [~] Design pass on the main screen
- [~] Get feedback from 3 to 5 people, including on the ARASAAC pictures, and capture quotes
- [~] Test the live URL end to end
- [~] Record the demo video (under 3 minutes)
- [~] Write the Kiro usage write-up
- [~] Social post with #KiroweenHackathon26

## Task Dependency Graph

Each wave depends only on tasks in earlier waves. Main dependencies: sentences (3) feed every checker; the spike (8) confirms the ARASAAC endpoint for 10 and drafts the rewrite prompt for 15; the orchestrator (16) needs the checker client (14) and the model calls (15); the result screen (22) comes before every report, editing and export task.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3", "7"] },
    { "id": 2, "tasks": ["4", "6"] },
    { "id": 3, "tasks": ["5", "9"] },
    { "id": 4, "tasks": ["8"] },
    { "id": 5, "tasks": ["10", "15"] },
    { "id": 6, "tasks": ["11", "18"] },
    { "id": 7, "tasks": ["12", "13"] },
    { "id": 8, "tasks": ["14"] },
    { "id": 9, "tasks": ["16"] },
    { "id": 10, "tasks": ["17", "19", "30"] },
    { "id": 11, "tasks": ["20", "21", "22", "31"] },
    { "id": 12, "tasks": ["23", "24", "25", "26", "29"] },
    { "id": 13, "tasks": ["27", "28"] },
    { "id": 14, "tasks": ["32"] },
    { "id": 15, "tasks": ["33"] }
  ]
}
```
