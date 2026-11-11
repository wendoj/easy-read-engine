# Day 1 spike results (task 8)

Recorded 11 November 2026 with `cd web && npm run spike` (`web/scripts/spike.ts`, scored by `checker/scripts/score.py`).

**Scope.** These results come from the 5 invented letters in `fixtures/letters/` only. They contain no real personal data. The 3 public sample council letters have not been added yet, so nothing here has been measured on a real council letter. This document records evidence only. The go/no-go decision and the model choice are left to you.

## Set-up

- Rewrite candidates came from `MODEL_REWRITE` in `.env`: `groq:openai/gpt-oss-120b` and `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free`. `gemini:gemini-3.5-flash-lite` was not a candidate, and `GEMINI_API_KEY` is not set, so Gemini was not tested.
- Keys present: `GROQ_API_KEY` true, `OPENROUTER_API_KEY` true, `GEMINI_API_KEY` false.
- Prompt: first draft of `prompts/rewrite.md`. Output requested through a `submit_lines` tool call. If there were no valid lines, the script retried once asking for plain JSON.
- `gpt-oss-120b` ran with `reasoning_effort: "low"`. Every request had `max_tokens: 3000`. The task 7 client sends no reasoning setting for Nemotron.
- Only P1, P2 and P4 exist so far, so only those were scored. P1 compares the output with key facts extracted from the Original.
- One pass per letter per candidate, 10 seconds between calls. The script ran 3 times: 2 earlier runs (02:10 and 02:13 UTC) and a final run (13:12 UTC). All 3 are reported because the free models varied a lot between runs.
- No provider returned 429 in any run. No model ID was rejected.

## Rewrite pass counts

Each cell is the number of letters (out of 5) that passed. "Scored" is how many letters returned valid lines.

| Candidate | Run | Scored | P1 | P2 | P4 | All 3 |
| --- | --- | --- | --- | --- | --- | --- |
| `groq:openai/gpt-oss-120b` | 02:10 | 5 | 3 | 1 | 0 | 0 |
| | 02:13 | 5 | 4 | 0 | 0 | 0 |
| | 13:12 (final) | 5 | 4 | 0 | 1 | 0 |
| `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free` | 02:10 | 4 | 1 | 3 | 2 | 0 |
| | 02:13 | 2 | 0 | 2 | 1 | 0 |
| | 13:12 (final) | 1 | 0 | 0 | 0 | 0 |

No output passed all 3 checks.

**gpt-oss-120b**

- Returned valid lines through the tool call in all 15 requests.
- P1: the Council Tax reminder lost the same required action (`k6`) in all 3 runs. One other run changed an action in the repair letter. Every date, amount, reference, phone number and address was kept.
- P2: 1 to 4 lines per letter went over 15 words.
- P4: 1 to 8 lines per letter used the passive. A spot check showed real passives, for example "is addressed to" and "was issued". These look like prompt problems, not checker false positives.

**Nemotron (OpenRouter free)**

- 8 of 15 letters returned no valid lines, for 2 reasons:
  - **Truncated.** The model spent all 3,000 output tokens on reasoning and stopped with `finish_reason: length` before it wrote the answer. This happened in 10 of 24 Nemotron requests across the 3 runs. In 4 letters both the tool request and the JSON retry were cut off.
  - **Empty reply.** In the final run, 4 letters got empty replies of 1 to 25 tokens with `finish_reason: stop`, on both the tool request and the JSON retry. This points to a problem with the free host at that time.
- When it did answer, it dropped many key facts. Up to 7 facts were missing in one letter, including dates, times and phone numbers.
- Average time was 41 to 51 seconds per request in the first 2 runs. gpt-oss-120b took about 2.5 seconds.

## Tokens per request

| Request | Design estimate | Measured |
| --- | --- | --- |
| Rewrite, `gpt-oss-120b` | about 4,000 | average 2,554 to 2,634 per run, maximum 3,068 (about 1,570 prompt and 980 completion; reasoning averaged 330 to 370 per request in the first 2 runs) |
| Rewrite, Nemotron | about 4,000 | average 4,395 to 4,610 in the first 2 runs, maximum 4,925, mostly reasoning. 10 of 24 requests stopped at the 3,000 output cap |
| Judge (P9, P10) | about 3,000 | **Not measured.** The judge doesn't exist yet (later task) |
| Vision, `qwen/qwen3.8-27b`, one 64 × 64 test image | none | 1,307 (1,305 prompt and 2 completion) |

These letters are short, with 14 to 15 sentences each, so a 1,500-word letter will use more prompt tokens. Every rewrite request here stayed under Groq's 8,000 tokens a minute. Because the script waited 10 seconds between calls, these runs don't show how many requests fit in a minute.

## Qwen vision on Groq

`groq:qwen/qwen3.8-27b` **accepts an image.** The script sent a generated 64 × 64 solid red PNG as an `image_url` data URL and asked for its colour. The model replied "Red" in about 0.3 to 0.4 seconds, with the same result in all 3 runs. No letter content was sent.

This shows only that the endpoint takes images. It doesn't test reading a photo of a letter or handwriting.

## ARASAAC catalogue endpoint

| URL | Status | Pictograms | Size | Time |
| --- | --- | --- | --- | --- |
| `https://api.arasaac.org/v1/pictograms/all/en` | 200 | 13,907 | 7.6 MB | about 2.5 s |
| `https://api.arasaac.org/api/pictograms/all/en` | 200 | 13,907 | 7.6 MB | about 2.3 s |

- Both URLs return the same full English catalogue as a JSON array. `/v1/pictograms/all/en` matches the `/v1/` path of the search endpoint, which is known to work.
- Each pictogram has these fields: `_id`, `aac`, `aacColor`, `categories`, `created`, `downloads`, `hair`, `keywords`, `lastUpdated`, `schematic`, `sex`, `skin`, `synsets`, `tags`, `violence`.
- 106 pictograms are flagged `violence` and 78 are flagged `sex`. Task 10 leaves these out.

## Pictogram coverage

For each output line, the script searched `GET /v1/pictograms/en/search/{symbolQuery}` and recorded whether at least 1 pictogram came back. A match only means the search returned something. Nobody has checked yet whether the pictures are correct or suit adult readers (design "Symbols", day 1 check).

| Candidate | Lines | Lines with a `symbolQuery` | Search returned a match | Share of all lines |
| --- | --- | --- | --- | --- |
| `gpt-oss-120b`, 3 runs | 233 | 222 | 195 | 84% |
| `gpt-oss-120b`, final run | 78 | 77 | 66 | 85% |
| Nemotron, 3 runs | 117 | 117 | 105 | 90% |

No search request failed.

## Not yet measured

- The 3 public sample council letters.
- P3 and P5 to P10, judge tokens, and whether the matched pictograms are correct.
- Gemini as a development fallback (no key set).
- How Nemotron behaves with a reasoning limit or a higher `max_tokens`. The task 7 client sends a reasoning setting only for `gpt-oss-120b` and the Qwen judge.

## Files

- `web/scripts/spike.ts`: the spike. Flags are `--letter=`, `--model=`, `--skip-vision` and `--skip-arasaac`.
- `checker/scripts/score.py`: the CLI over the checker. `analyse` returns sentences and key facts, and `score` runs P1, P2 and P4.
- Raw output and `summary.json` for each run are in `web/.spike-output/<timestamp>/`. This folder is gitignored, and the console showed only counts.
