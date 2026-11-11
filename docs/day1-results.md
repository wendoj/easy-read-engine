# Day 1 spike results (task 8)

Recorded 11 November 2026 with `cd web && npm run spike` (`web/scripts/spike.ts`, scored by `checker/scripts/score.py`).

**Scope.** The main sections below come from the 5 invented letters in `fixtures/letters/`. A later run on the 3 public sample letters is in [Public letters](#public-letters). None of the letters holds real personal data. This document records evidence only. The go/no-go decision and the model choice are left to you.

## Summary

- **No output passed P1, P2 and P4 together**, on the invented letters (3 runs) or the public letters (1 run).
- **gpt-oss-120b** returned usable lines for 15 of 15 invented-letter requests and 2 of 3 public letters. Most P1 failures were reworded required actions. On the invented letters every date, amount, reference, phone number and address was kept; on 2 public letters 1 date each went missing. Long lines (P2) and passives (P4) remained in most letters.
- **The longest public letter failed outright.** On the Manchester letter (1,071 words, 83 key facts), gpt-oss-120b called a tool that wasn't offered (400), and the plain-JSON retry returned 1 line.
- **Nemotron (OpenRouter free)** returned no valid lines for any public letter, and for 8 of 15 invented-letter requests.
- **Tokens:** gpt-oss-120b rewrite requests averaged 2,554 to 2,634 tokens on the invented letters and 3,781 on the public letters (maximum 4,089), under the design's 4,000 estimate on average.
- **Vision:** Groq's `qwen/qwen3.8-27b` accepts an image. **ARASAAC:** `/v1/pictograms/all/en` returns the full English catalogue (13,907 pictograms).
- **Pictogram search** returned a match for 84% of gpt-oss-120b lines on the invented letters and 81% on the public letters. Nobody has checked whether the matches are correct.

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

## Public letters

Recorded 11 November 2026 (13:34 UTC) with `npm run spike -- --set=public --skip-vision`. One pass per letter per candidate, with the same candidates, prompt and settings as above. The vision check was skipped because it had already passed. The ARASAAC catalogue check gave the same result as above.

The 3 letters are public templates and samples from East Cambridgeshire District Council, Manchester City Council and the Planning Inspectorate (see `fixtures/letters/README.md`). Their personal details are placeholders in the source, such as `DD.MM.YYYY` and `£XXX.XX`, so some key facts the extractor would find in a real letter aren't there.

| Letter | Words | Sentences | Key facts |
| --- | --- | --- | --- |
| `council-tax-final-notice-east-cambridgeshire.txt` | 855 | 33 | 36 |
| `manchester-missed-council-tax-payment.txt` | 1,071 | 78 | 83 |
| `planning-appeal-notification-letter.txt` | 624 | 43 | 6 |

### Pass counts

Each cell is the number of letters (out of 3) that passed.

| Candidate | Scored | P1 | P2 | P4 | All 3 |
| --- | --- | --- | --- | --- | --- |
| `groq:openai/gpt-oss-120b` | 3 | 0 | 1 | 1 | 0 |
| `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free` | 0 | 0 | 0 | 0 | 0 |

**gpt-oss-120b, per letter**

| Letter | Lines | P1 | P2 | P4 | Tokens | Time |
| --- | --- | --- | --- | --- | --- | --- |
| East Cambridgeshire | 28 | fail: 9 actions changed, 1 date missing (7 lines) | fail (4 lines) | fail (1 line) | 2,799 + 993 = 3,792 | 2.7 s |
| Manchester | 1 | fail: all 83 facts missing | pass | pass | 4,007 + 82 = 4,089 | 0.8 s |
| Planning Inspectorate | 41 | fail: 1 date missing (1 line) | fail (3 lines) | fail (19 lines) | 2,186 + 1,276 = 3,462 | 3.2 s |

- **Manchester.** The first request got a 429, and the script waited 20 seconds and retried once. The tool request then failed with a 400 (`tool_use_failed`), because the model called a tool named `json` that wasn't in the request. The plain-JSON retry returned valid JSON with only 1 line. The P2 and P4 passes for this letter are therefore meaningless. This is the longest fixture letter and the only one over 1,000 words.
- **Actions.** As with the invented letters, 9 of the 10 P1 failures on the East Cambridgeshire letter were reworded required actions.
- **Passives.** The Planning Inspectorate letter is written mostly in the passive ("will be determined", "must be received"), and 19 of the 41 output lines kept a passive.
- Reasoning averaged 41 tokens per request (`reasoning_effort: "low"`). No request was truncated.

**Nemotron.** All 6 requests (tool request and JSON retry for each letter) ended with `finish_reason: stop` after 1 to 20 completion tokens, with no valid lines. This matches the empty replies in the final invented-letter run and points to a problem with the free host, not with the letters.

### Tokens per request

| Request | Design estimate | Measured on public letters |
| --- | --- | --- |
| Rewrite, `gpt-oss-120b` | about 4,000 | average 3,781 (2,997 prompt and 784 completion), maximum 4,089 |
| Rewrite, Nemotron | about 4,000 | average 3,274, maximum 4,737, almost all prompt. Replies were 1 to 20 tokens |

The Manchester prompt was 4,007 tokens for 1,071 words. Scaling from that, a 1,500-word letter would need roughly 5,000 to 5,600 prompt tokens before any output, so with a full set of lines a request would come close to Groq's 8,000 tokens a minute.

### Pictogram coverage

| Candidate | Lines | Lines with a `symbolQuery` | Search returned a match | Share of all lines |
| --- | --- | --- | --- | --- |
| `gpt-oss-120b` | 70 | 70 | 57 | 81% |

The Manchester letter contributes only 1 line.

## Not yet measured

- A full rewrite of the Manchester letter, and any letter over 1,071 words.
- P3 and P5 to P10, judge tokens, and whether the matched pictograms are correct.
- Gemini as a development fallback (no key set).
- How Nemotron behaves with a reasoning limit or a higher `max_tokens`. The task 7 client sends a reasoning setting only for `gpt-oss-120b` and the Qwen judge.

## Files

- `web/scripts/spike.ts`: the spike. Flags are `--set=invented|public|all` (default `invented`), `--letter=`, `--model=`, `--skip-vision` and `--skip-arasaac`.
- `checker/scripts/score.py`: the CLI over the checker. `analyse` returns sentences and key facts, and `score` runs P1, P2 and P4.
- Raw output and `summary.json` for each run are in `web/.spike-output/<timestamp>/`. This folder is gitignored, and the console showed only counts.
