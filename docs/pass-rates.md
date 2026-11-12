# Pass rates

> **Bedrock fixture run, 12 November 2026 (spec task 35).** 8 letters: the 3 public sample letters and the 5 invented letters. Every letter finished with a checked result and every model request went to Bedrock. No letter passed all 10 rules: 6 ended flagged and 2 blocked. This is a run on 8 letters, not a pass rate on the planned 20 public letters.

- **Date:** 2026-11-12, 17:14 to 17:32 UTC
- **Command:** `cd web && npm run fixtures -- --all` (checker at `http://localhost:8000`, `APP_ENV=development`, default 15 s pause between letters)
- **Code:** commit `a8d723d` (the checker fix in `4023e6f`, which passes template placeholders and address lines in P5 and P7, came after this run)
- **Raw results:** `fixtures/results/20261112T171407Z-all.json`
- **Exit code:** 0

This file and the JSON hold rule results and metadata only. No letter text, Easy Read lines or key-fact values.

## Model chains

| Role | Chain, in order | Answered in this run |
| --- | --- | --- |
| Rewrite and regenerate | `bedrock:openai.gpt-oss-120b-1:0`, then `groq:openai/gpt-oss-120b` | Bedrock gpt-oss-120b, every rewrite and regenerate. 1 regenerate answer failed output validation and was retried on Bedrock |
| Judge (P9, P10) | `bedrock:qwen.qwen3-235b-a22b-2507-v1:0`, then `groq:qwen/qwen3.8-27b` | Bedrock Qwen3 235B, every judge call |
| Vision | `bedrock:qwen.qwen3-vl-235b-a22b`, then `groq:qwen/qwen3.8-27b` | Not used (no photos in the set) |

Model requests: 49 in total, 49 answered by Bedrock, none rate-limited and none sent to Groq. The judge was available on every try.

## Results

Status: **passed** means all 10 rules passed. **flagged** means the output is shown with failing rules flagged after 3 tries. **blocked** means P1 failed on all 3 tries, so no lines are shown. Each cell gives the failing-line count on the try the pipeline kept.

### Public sample letters (3)

| Letter | Source | Sentences | Status | Tries | Lines | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| council-tax-final-notice-east-cambridgeshire | pdf | 89 | flagged | 3 | 67 | ok | 11 | 15 | 6 | 7 | ok | 5 | ok | 21 | ok |
| manchester-missed-council-tax-payment | pdf | 143 | blocked | 3 | 0 | 1 fact | ok | 7 | ok | 14 | ok | 2 | ok | 24 | ok |
| planning-appeal-notification-letter | txt | 51 | flagged | 3 | 67 | ok | ok | ok | 3 | 7 | ok | 1 | ok | 24 | ok |

A blocked letter shows no lines, so its counts come from the last try, which failed P1 on 1 key fact. On Manchester the first rewrite came back in under 2 seconds with very few lines for a 143-sentence letter, and regenerate could not recover every missing key fact in 2 more tries.

### Invented letters (5)

| Letter | Sentences | Status | Tries | Lines | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| invented-care-assessment | 20 | flagged | 3 | 27 | ok | ok | 3 | ok | 7 | ok | ok | ok | 4 | 3 |
| invented-council-tax-reminder | 16 | blocked | 3 | 0 | 1 fact | ok | ok | 1 | 2 | ok | ok | ok | 5 | ok |
| invented-housing-benefit-change | 19 | flagged | 3 | 25 | ok | ok | 1 | ok | ok | ok | 1 | ok | 1 | ok |
| invented-parking-penalty | 17 | flagged | 3 | 29 | ok | ok | 2 | 2 | 4 | ok | ok | ok | 4 | ok |
| invented-repair-appointment | 17 | flagged | 3 | 25 | ok | ok | 2 | 1 | 6 | 1 | 1 | ok | 4 | ok |

### Totals

| | Public (3) | Invented (5) | All (8) |
| --- | --- | --- | --- |
| Finished (passed, flagged or blocked) | 3 | 5 | 8 |
| Passed | 0 | 0 | 0 |
| Flagged | 2 | 4 | 6 |
| Blocked | 1 | 1 | 2 |
| Error | 0 | 0 | 0 |

Letters passing each rule, out of 8:

| P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6/8 | 7/8 | 2/8 | 3/8 | 1/8 | 7/8 | 3/8 | 8/8 | 0/8 | 7/8 |

## Compared with the earlier run

The earlier run (11 November 2026, `fixtures/results/20261111T164114Z-all.json`) used the free Groq and OpenRouter chains. 6 of its 8 letters stopped with a provider or model-output error, and only 2 invented letters finished, both flagged. On Bedrock every letter finished, nothing was rate-limited, and the judge answered every time. The rules are now the limit, not the providers.

## What fails, and why

- **P9 (meaning) fails on every letter.** It is the most common failure on the long public letters (21 to 24 lines). Earlier recorded samples show the judge failing lines for plain swaps of legal words ("amended" written as "changed") and for shortened official names. Some of those are real meaning changes and some are the judge being stricter than its rubric.
- **P3, P4 and P5 are the main checker failures.** These are lines the model wrote: "... if you can" and "when you ..." clauses, copied passives ("is set out in"), and letter words left in.
- **Blocks come from missing key facts.** Both blocked letters lost 1 key fact. On Manchester, the first rewrite was far too short for the letter.

## Changes after this run

These came after the run above and are not in its numbers.

- **Long letters.** On Manchester (143 sentences) gpt-oss-120b often reasoned that the task was too big and answered with almost no lines. In 3 local tries, 1 request covered 75 to 105 of the 143 sentences. The rewrite now goes in parts of up to 60 sentences (`750a945`). A local try then covered 136. The longer output then broke the judge: 158 lines gave an invalid answer twice, so every line failed as "judge unavailable". The judge now goes in batches of whole sentences, up to 40 lines each (`2f13fcb`).
- **Checker.** P5 and P7 pass X placeholders copied from a template letter ("£XXX.XX") and, in P7, address lines before a key-fact postcode, as P5 already did (`4023e6f`). Key facts: an action stops at a dash ("Please pay online now – details on the back" asked for "pay details"), and a heading question ("Need help with council tax?") is not an action (`d21042c`). Each has regression and still-fails tests.
- **Prompts and plain words.** Worked examples for "if you can", "when" and "if" at the end of a line, "Then" only after "Maybe", template blanks and capitals for emphasis (`4b8230e`). The judge now passes plain swaps for official words, shortened official names, repeated facts, correct definitions of hard words and "Maybe" and "Then" for "if" (`4b8230e`, `be0beaf`). 7 plain-word swaps added (`7a96564`).

## Re-recorded samples

The public samples were re-recorded on Bedrock on 12 November 2026, with the long-letter, prompt and first checker changes, but before the key-fact fix in `d21042c` and the judge's "Maybe" and "Then" rule in `be0beaf` (`58055db`). East Cambridgeshire and the planning letter ended flagged. Manchester was blocked on P1 on every try, so its 11 November recording is kept. 0 public letters pass all 10 rules. Per-rule counts are in `web/data/samples/README.md`.
