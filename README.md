# Easy Read Engine

## What it does

Easy Read Engine turns an official letter, such as a council tax notice, into Easy Read: short sentences, plain words and a picture for each line. You paste the text, upload a typed PDF or take a photo of the letter.

Every Easy Read line is checked against a fixed set of rules (P1 to P10) before you see it. The original letter stays on screen next to the Easy Read version, and key facts such as dates, amounts and reference numbers are highlighted in both. You can edit lines and export the result as a PDF.

It is for adults with learning disabilities, low literacy or English as a second language, and for the carers and support workers who read letters with them (`docs/brief.md`). The Easy Read version says what the letter says. It never tells the reader what to do.

## Prior art

AI Easy Read tools already exist. Swindon Borough Council built [Simply Readable](https://www.local.gov.uk/case-studies/swindon-borough-council-simply-readable-ai-easy-read-solution), an AI Easy Read generator on Amazon Bedrock. According to the Local Government Association case study (read again on 11 November 2026), it is open source, and the council worked with a group of residents with learning disabilities throughout its development. Social workers put in the information and get an Easy Read version in under 30 minutes. The case study puts the cost at about 1p per page, against about £120 per A4 page made by hand. It says a complex 5 to 10 page document could cost more than £600 to convert before, and now costs 7 to 10p. It also says the tool can translate into 75 languages. The case study does not describe any automated check of the output: no rule checks, no check that key facts are kept, and no tracing of lines back to the source.

Easy Read Engine solves a different part of the problem:

- **Who it is for.** The person who received the letter, or their carer, rather than staff writing Easy Read documents.
- **Every line is checked.** Rules P1 to P8 run in a checker with no model (`checker/src/checks/`), and 2 model judges check meaning (P9) and tone and advice (P10).
- **Key facts block the output.** If no try keeps every date, amount, reference number and other key fact unchanged, no lines are shown and export is turned off.
- **You can check it against the letter.** The original is shown side by side. Each line is traced to the sentence it came from, and key facts are highlighted in both columns.
- **No advice.** P10 fails any line that tells the reader what to decide.
- **The checker is tested.** Hypothesis and fast-check property tests, cases the checker must fail, and a mutation test (`checker/tests/`, `web/tests/`).

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

## Access

Anyone can open the sample letters, read them in Easy Read and export them as PDFs. These make no model call.

Live conversion (paste, upload, convert and line edits) calls a paid model, so it needs the judge access key. Hackathon judges get the key through the private Devpost form. On the input screen, select **I have an access key** and type it. The server sets a cookie that lasts 30 days.

The key is set in `ACCESS_KEY` (see `.env.example` and [docs/deploy.md](docs/deploy.md)). With `ACCESS_KEY` empty, every route is open in development (`APP_ENV=development`, or `npm run dev` and Vitest when `APP_ENV` is unset), and live conversion is closed everywhere else, including `npm start` without `APP_ENV`.

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

The `fixtures`, `spike`, `record-samples` and `needs_model` commands call real model providers. They cost money on Bedrock and use Groq quota on the fallback. Start the checker first.

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

## How it is stitched together (Frankenstein)

The project joins parts that don't usually work together. The model writes, and the deterministic parts decide what the reader sees.

| Part | What it does |
| --- | --- |
| Language models | Rewrite the letter into Easy Read lines, regenerate lines that failed, judge meaning (P9) and tone and advice (P10), and read photos of letters. Amazon Bedrock in `eu-west-2` first, Groq as the fallback |
| spaCy dependency parsing | Splits sentences, extracts key facts and runs P2 to P7 in the checker. No model, so the same input always gives the same result |
| ARASAAC pictogram library | Gives each line a picture, and P8 checks every picture ID against the committed index. CC BY-NC-SA |
| Hypothesis and fast-check property tests | Prove the checker is right: generated letters with random dates, amounts and passive sentences, cases the checker must fail, and a mutation test that changes one fact and expects P1 to fail |
| Headless Chromium | Renders the print page to an A4 PDF |

How the checker gates the model:

- Key facts are taken from the original before the model writes anything, so P1 compares the output with the original, never with itself.
- If the last try fails P1 but an earlier try passed it, the latest try that passed P1 is shown, with its own checks.
- If no try passes P1, or P1 fails after a user edit, the output is blocked: no lines are shown, the failed key fact is named and export is turned off.
- If any other rule still fails after 3 tries, the output is shown with that rule flagged.
- If the advice check (P10) could not run, export is turned off.
- If the checker service is down, nothing is shown (503).

## Demo

1. Paste a sample letter, or upload a typed PDF. Check the text, then convert it.
2. The Easy Read version appears on the right, with the original on the left. Select a line to highlight the sentence it came from.
3. Open the rule report from the pass count to see each rule and the lines it applied to.
4. Edit a line and change its date, for example from 1 April 2026 to 2 April 2026. The checker runs again. P1 fails, the output is blocked, the changed date is named and export is turned off.
5. Select **Undo edit** to get the checked version back.

The notice that the Easy Read version is a simplified copy, and the original letter is the official one, stays on screen the whole time.

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

The rules come from published Easy Read guidance (see [Easy Read guidance](#easy-read-guidance)). The exact limits, such as 15 words for P2, are this project's choice, to tune against real Easy Read documents.

## Model providers

Each role (rewrite, judge, vision) has an ordered list of `provider:model` entries in `.env` (`MODEL_REWRITE`, `MODEL_JUDGE`, `MODEL_VISION`). The providers are `bedrock` and `groq`, and any other name stops the app at start-up. The client moves to the next entry after a rate-limit error, a server error, a 401, 403 or 404, or a timeout. Each result records which provider and model answered.

| Role | First | Fallback |
| --- | --- | --- |
| Rewrite and regenerate | `bedrock:openai.gpt-oss-120b-1:0` | `groq:openai/gpt-oss-120b` |
| Judge (P9, P10) | `bedrock:qwen.qwen3-235b-a22b-2507-v1:0` | `groq:qwen/qwen3.8-27b` |
| Vision (photos) | `bedrock:qwen.qwen3-vl-235b-a22b` | `groq:qwen/qwen3.8-27b` |

- **Amazon Bedrock** (first choice, paid per token). The app calls the OpenAI-compatible [Chat Completions API](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html) on `bedrock-runtime` in `AWS_REGION` (default `eu-west-2`, London), with a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK`. It uses plain model IDs and no cross-Region inference profile, so letter text stays in London. All three models were listed as In-Region in London on 11 November 2026 ([Regional availability](https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html)). Create the key in the Bedrock console under API keys.
- **Groq** (fallback, free plan). The [Groq rate limits page](https://console.groq.com/docs/rate-limits) lists `openai/gpt-oss-120b` and `qwen/qwen3.8-27b` at 30 requests a minute, 1,000 requests a day, 8,000 tokens a minute and 200,000 tokens a day each. These limits change often, so check the page again before relying on them.

## Kiro setup

The `.kiro/` folder holds the spec, steering, hooks and MCP config used to build this project. [docs/kiro-usage.md](docs/kiro-usage.md) describes how each was used.

- **MCP server.** `.kiro/settings/mcp.json` starts `easy-read-checker` with `uv --directory checker`, a path relative to the workspace root, so it works in any clone. If your Kiro starts MCP servers from a different folder, change `checker` to the full path of the `checker` folder.
- **Kiro Power.** `power-easy-read/` packages the checker MCP server and the Easy Read rules as a [Kiro Power](https://kiro.dev/docs/powers/create/), so other Kiro projects can use the same checks. It needs a clone of this repository. See `power-easy-read/README.md`.
- **Reviewer agent.** `.kiro/agents/easy-read-reviewer.md` is a read-only [custom agent](https://kiro.dev/docs/custom-agents/) that reviews Easy Read lines, fixtures and prompt changes by calling the checker tools. It loads `easy-read-rules.md` and `safety.md` and can't edit files.

## AWS MCP servers (development)

`.kiro/settings/mcp.json` also lists two AWS servers next to `easy-read-checker`. Both run on your machine through `uvx` and are never deployed:

- `aws-mcp`: the [AWS MCP Server](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/getting-started-aws-mcp-server.html) through `mcp-proxy-for-aws-cli`, signed with SigV4 using your AWS CLI profile (`AWS_PROFILE`, default `default`), with `AWS_REGION=eu-west-2`. Sign in first with `aws login`. Tools need your approval each time.
- `aws-docs`: `awslabs.aws-documentation-mcp-server`, for AWS documentation search. It needs no credentials.

## Easy Read guidance

The rules follow two published guides:

- **IE**: Inclusion Europe, [Information for all: European standards for making information easy to read and understand](https://www.inclusion-europe.eu/wp-content/uploads/2017/06/EN_Information_for_all.pdf), written by the "Pathways to adult education for people with intellectual disabilities" project partners in 2010 ([standards page](https://www.inclusion-europe.eu/easy-to-read-standards-guidelines/)). Section 1 is "General standards for easy to understand information" and section 2 is "Standards for written information". Numbers below are section and standard, so IE 2.19 is standard 19 in section 2.
- **DH**: Department of Health, [Making written information easier to understand for people with learning disabilities: guidance for people who commission or produce Easy Read information](https://www.gov.uk/government/publications/making-written-information-easier-to-understand-for-people-with-learning-disabilities-guidance-for-people-who-commission-or-produce-easy-read-information-revised-edition-2010), revised edition, 18 November 2010. Numbers below are sections of Annex A, "Guidelines for producing Easy Read".

| Rule | What the guides say |
| --- | --- |
| P1 key facts | DH A1: "Important dates to be highlighted at the beginning of the document", for example "the date that a response is needed to a letter". IE 2.23: "Make sure the important information is easy to find". Neither guide says facts must be copied unchanged; that rule is ours |
| P2 short sentences | IE 1.14 and 2.19: "Keep your sentences short". DH A6 "Length": "Each sentence to be as short as possible. More than 15 words is harder to read" |
| P3 one idea per sentence | IE 2.19: "writing only 1 idea per sentence" and "using a full stop before starting a new idea, instead of using a comma or an 'and'" |
| P4 active voice | IE 1.17: "Use active language rather than passive language where possible. For example, say 'The doctor will send you a letter' not 'you will be sent a letter'" |
| P5 plain words | IE 1.6: "Use easy to understand words that people will know well". IE 1.7 and 2.11: explain difficult words. DH A3: "Explain difficult words the first time they appear" |
| P6 numbers as digits | IE 2.42: "Write numbers as digits, not as words". DH A4: "Express all numbers in figures, including 1 to 10" |
| P7 abbreviations | IE 1.12: "Avoid using initials ... If you have to use initials, explain them". IE 2.16: "Avoid all abbreviations like 'e.g.' or 'etc.'". DH A3: "It is best not to use acronyms or abbreviations ... You should use the full title the first time" |
| P8 pictures | IE 2.34 to 2.38 and DH A2 "Pictures": pictures go next to the text and must match it. DH A1: "You do not have to put a picture against every single sentence". Checking each ID against the ARASAAC index is our own rule |
| Speak to "you" | IE 1.15: "Speak to people directly. Use words like 'you' to do this" |
| P10 tone | IE 1.3: "do not use language for children when your information is for adults". DH Annex B 1: pictures "simple and easy to understand, but not patronising" |
| P10 no advice | Neither guide has this rule. It is ours (`safety.md`, R7.2). Both guides say good information helps people make their own decisions (IE "Why do we need these standards?", DH 2.2) |

The guides give advice. The checker turns each point into a pass or fail rule, and those limits are this project's choice. DH says a sentence of more than 15 words "is harder to read"; making 15 words a hard limit is ours. P3 splits clauses joined by "and" or "but", although DH A4 says it is fine to start a sentence with "and" or "but".

### What the guides say about layout

These points apply to the screens and the PDF, not to the line checks:

- Use a clear sans-serif font such as Arial (IE 2.5, DH A3). Text at least the size of Arial 14 (IE 2.6), and at least 16 point for print (DH A3). The PDF uses Arial at 18pt (`web/src/export/print-document.ts`).
- No italics, no whole words in capitals, left-aligned text (IE 2.5, 2.7, 2.28; DH Annex B 4).
- Pictures to the left of the text (DH A2).
- Black or very dark text on a white or light cream background (DH A7).
- "Do not write in columns" (IE 2.27). The result screen shows the original and the Easy Read version side by side so the reader or a supporter can check one against the other. The exported PDF has the Easy Read version only, one idea per line.
- "Do not have animations on the screen" (IE section 3, standard 21, for websites).
- Write dates in full, such as "Tuesday 13 October 2008" (IE 2.45, DH A4). The app keeps each date as the letter writes it, because P1 needs the same value.

### Testing with readers

Both guides say to involve people with learning disabilities and test with them (IE 1.5, DH section 4 and A9). An Easy Read checker tried the app and told us it was easy to use and helped a lot. That was 1 informal check, not testing with readers, which hasn't been done yet.

## Safety

- **No letter text is stored or logged.** Letters are processed in memory. Logs hold only rule results, attempt counts, timings and the provider and model that answered. The only stored data is the pictogram image cache.
- **The original letter is the official one.** It is shown next to every result, and every result and exported PDF says the Easy Read version is a simplified copy.
- **Key facts must match.** If a key fact from the original is missing or changed on all 3 tries, or after an edit, the output is blocked: no lines are shown, the failed key fact is named and export is turned off.
- **No advice.** The output says what the letter says. It never tells the reader what to decide. The P10 judge checks every line for advice.
- Letter text is sent to an outside AI provider. The app tells users this and asks them not to upload letters with personal details.

## Licences

- **Code:** MIT. See [LICENSE](LICENSE).
- **Pictograms:** Pictograms: Sergio Palao. Origin: ARASAAC (https://arasaac.org). Licence: CC BY-NC-SA. Owner: Government of Aragón (Spain). See `checker/data/LICENSE-pictograms.md`. The licence is non-commercial, so the pictograms can't be used in a commercial product without permission from the owner, even though the code is MIT.
- **Word list:** the New General Service List (NGSL), used by the P5 plain-words check, is licensed CC BY-SA 4.0. See `checker/src/checks/wordlist/README.md`.

## Status and known limitations

- [docs/day1-results.md](docs/day1-results.md): day 1 spike results.
- [docs/pass-rates.md](docs/pass-rates.md): the latest 8-letter run (13 November 2026) ended with 0 passed and 8 flagged. P1 passed on all 8 letters, and P9 on 2. One invented letter passed all 10 rules in a single run. The P3 code split has had no live run.
- The 3 public samples in `web/data/samples/` are all flagged. None passes all 10 rules.
- [docs/deploy.md](docs/deploy.md): the Chromium sandbox is turned off for PDF export in the container. The live deploy is still pending.
