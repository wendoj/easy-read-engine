# Pass rates

> **Bedrock samples, 11 November 2026.** After this run, the 3 public sample letters were recorded on the Bedrock chain (`web/data/samples/`, `npm run record-samples`). Each ended flagged after 3 tries, with P1 passing on all 3. The 8-letter fixture run on Bedrock (spec task 35) is still to do, and will replace the numbers below.

> **Partial: 8 of the planned 20 public letters (3 public, 5 invented).** Only 3 public sample letters are in `fixtures/letters/` so far, so this run also includes the 5 invented letters. 6 of the 8 letters ended with a provider or model-output error, not a rule result. Treat these numbers as a smoke test of the pipeline on free-tier providers, not as a pass rate.

- **Date:** 2026-11-11, 16:41 to 16:49 UTC
- **Command:** `cd web && FIXTURE_DELAY_MS=45000 npm run fixtures -- --all` (checker at `http://localhost:8000`, `APP_ENV=development`)
- **Raw results:** `fixtures/results/20261111T164114Z-all.json`
- **Exit code:** 1 (at least one letter hit a model error)

This file and the JSON hold rule results and metadata only. No letter text, Easy Read lines or key-fact values.

## Model chains

| Role | Chain, in order | Answered in this run |
| --- | --- | --- |
| Rewrite and regenerate | `groq:openai/gpt-oss-120b`, then `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free` | Groq gpt-oss-120b gave every valid answer (7 rewrites, 7 regenerates). Nemotron answered 9 times, all invalid |
| Judge (P9, P10) | `groq:qwen/qwen3.8-27b`, then `openrouter:thinkingmachines/inkling-small:free` | Groq qwen3.8-27b, 5 valid answers. 4 judge calls had no provider answer |
| Vision | `groq:qwen/qwen3.8-27b`, then `openrouter:nvidia/nemotron-3.5-super-vl:free` | Not used (no photos in the set) |

## Results

Status: **passed** means all 10 rules passed. **flagged** means the output is shown with failing rules flagged after 3 tries. **blocked** means P1 failed after 3 tries. **error** means the letter stopped before a checked result.

### Public sample letters (3)

| Letter | Source | Status | Tries | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | Model requests (ok / rate-limited / client error) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| council-tax-final-notice-east-cambridgeshire | pdf | error: model_output_invalid | – | – | – | – | – | – | – | – | – | – | – | 13 (4 / 4 / 5) |
| manchester-missed-council-tax-payment | pdf | error: model_output_invalid | – | – | – | – | – | – | – | – | – | – | – | 3 (1 / 1 / 1) |
| planning-appeal-notification-letter | txt | error: providers_unavailable | – | – | – | – | – | – | – | – | – | – | – | 11 (3 / 6 / 2) |

### Invented letters (5)

| Letter | Source | Status | Tries | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | Model requests (ok / rate-limited / client error) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| invented-care-assessment | txt | flagged | 3 | ok | ok | ok | ok | FAIL (1 line) | ok | ok | ok | FAIL* | FAIL* | 8 (4 / 2 / 2) |
| invented-council-tax-reminder | txt | error: model_output_invalid | – | – | – | – | – | – | – | – | – | – | – | 5 (3 / 1 / 1) |
| invented-housing-benefit-change | txt | flagged | 3 | ok | ok | ok | ok | ok | ok | FAIL (1 line) | ok | FAIL* | FAIL* | 9 (4 / 2 / 3) |
| invented-parking-penalty | txt | error: model_output_invalid | – | – | – | – | – | – | – | – | – | – | – | 9 (5 / 3 / 1) |
| invented-repair-appointment | txt | error: model_output_invalid | – | – | – | – | – | – | – | – | – | – | – | 9 (5 / 3 / 1) |

\* The judge was unavailable on the final try, so P9 and P10 are recorded as failed on every line. This is "judge unavailable", not a judged failure. The run records only the final try per letter, so there is no judged P9 or P10 result for these letters.

### Totals

| | Public (3) | Invented (5) | All (8) |
| --- | --- | --- | --- |
| Finished (passed, flagged or blocked) | 0 | 2 | 2 |
| Passed | 0 | 0 | 0 |
| Flagged | 0 | 2 | 2 |
| Blocked | 0 | 0 | 0 |
| Error | 3 | 3 | 6 |

Rule passes, counted over the 2 finished letters (both invented):

| P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2/2 | 2/2 | 2/2 | 2/2 | 1/2 | 2/2 | 1/2 | 2/2 | 0/2* | 0/2* |

Model requests across the run: 67 total, 29 ok, 22 rate-limited, 16 client errors.

## Known provider issues

These were known before the run and were not changed for it.

- **Groq per-minute limits.** Groq returned 429 on 22 of 67 requests, even with a 45 s pause between letters. Each 429 sends the request to the OpenRouter fallback.
- **Rewrite fallback output is invalid.** `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free` answered 9 times and every answer failed output validation. When Groq is rate-limited during a rewrite or regenerate, the letter ends with `model_output_invalid`. This caused 5 of the 6 errors.
- **Judge fallback returns 404.** `openrouter:thinkingmachines/inkling-small:free` returns 404, so a Groq 429 on a judge call leaves P9 and P10 unavailable for that try. This is why both flagged letters show P9 and P10 as failed.
- **Both providers down for one letter.** The planning appeal letter ended with `providers_unavailable` after 6 rate-limited requests.

## Notes on the run

- An earlier attempt the same day was stopped by the shell tool's timeout during letter 3. It wrote no results file. It used about 11 model requests. The run above is the only complete run.
- The rule results from the 2 finished letters are the only real pass-rate evidence here. A full run needs the 20 public letters, a working rewrite fallback and a working judge fallback, or a paid or higher Groq limit.
