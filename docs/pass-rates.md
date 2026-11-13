# Pass rates

## Latest: fixture run of 13 November 2026, and fixes after it

> **No letter has passed all 10 rules in a full fixture run.** The run on 13 November 2026 (8 letters, Bedrock, `fixtures/results/20261113T103145Z-all.json`, started 10:31 UTC) ended with 0 passed, 6 flagged and 2 blocked on P1. That is the same split as the 12 November runs. It is 8 letters, not a pass rate on the planned 20 public letters. The run was made after the judge rubric change (`9ad9ef1`) and before the P1 and P3 fixes listed below.

Rules that passed, out of 8 letters: P1 6, P2 4, P3 1, P4 5, P5 2, P6 7, P7 3, P8 8, P9 3, P10 6. Against the 12 November run on `66a8d0b`, **P9 went from 0 of 8 to 3 of 8**. P2 passed on 1 fewer letter, P3 on the same 1, and P1, P5 and P8 were unchanged. With 3 tries from a model that answers differently each time, a change of 1 letter is within run-to-run variation.

| Letter | Status | Failing rules (lines) |
| --- | --- | --- |
| council-tax-final-notice-east-cambridgeshire | flagged | P2 11, P3 14, P4 6, P5 13, P7 5, P9 10 |
| manchester-missed-council-tax-payment | blocked | P1 10, P2 1, P3 10, P5 5, P9 29, P10 2 |
| planning-appeal-notification-letter | flagged | P2 2, P3 6, P4 5, P5 3, P7 1, P9 17, P10 6 |
| invented-care-assessment | flagged | P3 1, P5 2, P7 1, P9 2 |
| invented-council-tax-reminder | blocked | P1 1, P7 2 |
| invented-housing-benefit-change | flagged | P3 1, P7 1 |
| invented-parking-penalty | flagged | P3 1, P5 2 |
| invented-repair-appointment | flagged | P2 1, P3 2, P4 2, P5 4, P6 1, P9 5 |

### Why the 2 letters were blocked, and what changed after

Both blocks came from the key-fact extractor reading things as required actions that the letter does not require. The rules were not relaxed: P1 still compares every date, amount, reference, phone number and address, and it still compares actions. The fixes, all with regression tests:

- **Weekday ranges** ("Monday—Friday" and "Monday to Friday") now have one value (`a3876d2`).
- **Offers are not orders.** Bullets under "We could:", "You can ...:" or "It's easy to ...:" are options the letter gives, not actions (`a3876d2`, `83092cd`). Bullets under "You must ...:" are still required.
- **"So you don't have to pay"** is no duty, so it is not an action (`a3876d2`).
- **A noun heading the language model tags as a verb** ("Council Tax reminder notice") is not an action (`83092cd`). This was the whole block on the invented council tax letter.
- **P9 judge.** The rubric no longer fails a line for repeating another line, accepts correct definitions of words and abbreviations from the sentence, and accepts a label on a letter header. The judge also sees the postcode line that the sentence splitter separates from an address (`9ad9ef1`).
- **P3 in code.** A line that ends in an "if" clause, or has 2 clauses joined by ", and" with their own subjects, is split before the checks, as "If X, Y." lines already were (`0f5bff9`). On the 20 lines that failed P3 in the recorded samples, this alone fixes 7.

### Live results after those fixes (single runs, not a pass rate)

These are one run per letter, made after `83092cd` and before `0f5bff9`, with the full pipeline on Bedrock:

- **invented-council-tax-reminder: passed all 10 rules** on the second try. This is the only time any letter has passed all 10, and it is 1 run.
- **Manchester: flagged, not blocked.** P1 passed on all 3 tries. After try 3, P2 (4 lines), P3 (25), P9 (24) and P10 (1) still failed. Its re-recorded sample (`web/data/samples/`) is flagged, with P3, P5, P9 and P10 failing. In the 13 November fixture run the same letter was blocked, so it can still miss P1 from run to run.

The P3 split in `0f5bff9` has had no live run. The full fixture run was not repeated after these fixes, so the table above does not include them.

### What is not done

- No reader testing with Easy Read readers, and 3 of the planned 20 public letters.
- Every sentence in the Original getting a line, or a "left out" marker, is not checked.
- Long letters are still slow (Manchester takes about 6 minutes) and run their parts one after another.

---

## Earlier: fixture run of 12 November 2026 (superseded)

The sections below describe the run on `66a8d0b`. Its numbers are kept as a record and are not current.

> **Bedrock fixture run on `66a8d0b`, 12 November 2026.** The checker fix `657bd8f` came after this run and has had no live run (see "Changes after this run"). 8 letters: the 3 public sample letters and the 5 invented letters. Every letter finished with a checked result and every model request went to Bedrock. No letter passed all 10 rules: 6 ended flagged and 2 blocked, the same split as the run on `a8d723d`. This is a run on 8 letters, not a pass rate on the planned 20 public letters.

- **Date:** 2026-11-12, 19:56 to 20:18 UTC
- **Command:** `cd web && npm run fixtures -- --all` (checker at `http://localhost:8000`, `APP_ENV=development`, default 15 s pause between letters)
- **Code:** commit `66a8d0b`, which has every fix listed under "Changes since the a8d723d run" below. It does not have `657bd8f`, which came after
- **Raw results:** `fixtures/results/20261112T195656Z-all.json`
- **Exit code:** 0

This file and the JSON hold rule results and metadata only. No letter text, Easy Read lines or key-fact values.

## Model chains

| Role | Chain, in order | Answered in this run |
| --- | --- | --- |
| Rewrite and regenerate | `bedrock:openai.gpt-oss-120b-1:0`, then `groq:openai/gpt-oss-120b` | Bedrock gpt-oss-120b, every rewrite and regenerate. 1 regenerate answer failed output validation and was retried on Bedrock |
| Judge (P9, P10) | `bedrock:qwen.qwen3-235b-a22b-2507-v1:0`, then `groq:qwen/qwen3.8-27b` | Bedrock Qwen3 235B, every judge call |
| Vision | `bedrock:qwen.qwen3-vl-235b-a22b`, then `groq:qwen/qwen3.8-27b` | Not used (no photos in the set) |

Model requests: 76 in total, 76 answered by Bedrock, none rate-limited and none sent to Groq. The judge was available on every try. The run has more requests than the `a8d723d` run (49) because long letters are now rewritten in parts and judged in batches.

## Results

Status: **passed** means all 10 rules passed. **flagged** means the output is shown with failing rules flagged after 3 tries. **blocked** means P1 failed on all 3 tries, so no lines are shown. Each cell gives the failing-line count on the try the pipeline kept.

### Public sample letters (3)

| Letter | Source | Sentences | Status | Tries | Lines | Time | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| council-tax-final-notice-east-cambridgeshire | pdf | 89 | flagged | 3 | 160 | 339 s | ok | 1 | 5 | 4 | 7 | ok | 2 | ok | 17 | ok |
| manchester-missed-council-tax-payment | pdf | 143 | blocked | 3 | 0 | 354 s | 3 facts | 3 | 7 | ok | ok | ok | ok | ok | 26 | 7 |
| planning-appeal-notification-letter | txt | 51 | flagged | 3 | 80 | 171 s | ok | 2 | 3 | 6 | 4 | ok | 1 | ok | 9 | ok |

A blocked letter shows no lines, so its counts come from the last try. Manchester failed P1 on all 3 tries and missed 3 key facts on the last one.

### Invented letters (5)

| Letter | Sentences | Status | Tries | Lines | Time | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| invented-care-assessment | 20 | flagged | 3 | 14 | 58 s | ok | ok | 1 | 2 | 2 | ok | 1 | ok | 5 | ok |
| invented-council-tax-reminder | 16 | blocked | 3 | 0 | 51 s | 1 fact | ok | ok | ok | ok | ok | ok | ok | 1 | ok |
| invented-housing-benefit-change | 19 | flagged | 3 | 25 | 76 s | ok | ok | 2 | 3 | 2 | ok | 1 | ok | 1 | ok |
| invented-parking-penalty | 17 | flagged | 3 | 28 | 67 s | ok | ok | 2 | 2 | 1 | ok | ok | ok | 3 | ok |
| invented-repair-appointment | 17 | flagged | 3 | 23 | 73 s | ok | ok | 3 | 2 | 6 | 1 | 1 | ok | 4 | ok |

On the care assessment letter, tries 2 and 3 failed P1, so the pipeline kept try 1, the latest try that passed P1, with its own checks. The council tax reminder failed P1 on 1 key fact on every try. Its last try failed only P1 and P9.

### Totals

| | Public (3) | Invented (5) | All (8) |
| --- | --- | --- | --- |
| Finished (passed, flagged or blocked) | 3 | 5 | 8 |
| Passed | 0 | 0 | 0 |
| Flagged | 2 | 4 | 6 |
| Blocked | 1 | 1 | 2 |
| Error | 0 | 0 | 0 |

Letters passing each rule, out of 8:

| Run | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `66a8d0b` (this run) | 6/8 | 5/8 | 1/8 | 2/8 | 2/8 | 7/8 | 3/8 | 8/8 | 0/8 | 7/8 |
| `a8d723d` | 6/8 | 7/8 | 2/8 | 3/8 | 1/8 | 7/8 | 3/8 | 8/8 | 0/8 | 7/8 |

## Compared with the a8d723d run

The `a8d723d` run (`fixtures/results/20261112T171407Z-all.json`, 17:14 to 17:32 UTC the same day) also ended with 0 passed, 6 flagged and 2 blocked, and the same 2 letters were blocked. Per letter, on the try the pipeline kept:

| Letter | Lines (a8d723d to 66a8d0b) | P9 failing lines | Rules failed |
| --- | --- | --- | --- |
| council-tax-final-notice-east-cambridgeshire | 67 to 160 | 21 to 17 | 6 to 6 |
| manchester-missed-council-tax-payment | blocked, both runs | 24 to 26 | 5 to 5. P1 missed 1 fact, now 3 |
| planning-appeal-notification-letter | 67 to 80 | 24 to 9 | 4 to 6 |
| invented-care-assessment | 27 to 14 | 4 to 5 | 4 to 5 |
| invented-council-tax-reminder | blocked, both runs | 5 to 1 | 4 to 2 |
| invented-housing-benefit-change | 25 to 25 | 1 to 1 | 3 to 5 |
| invented-parking-penalty | 29 to 28 | 4 to 3 | 4 to 4 |
| invented-repair-appointment | 25 to 23 | 4 to 4 | 6 to 6 |

- **Long letters are now covered.** East Cambridgeshire went from 67 to 160 lines for 89 sentences. That is the effect of rewriting in parts (`750a945`, `f42c83e`). With more lines, P2 and P4 now fail on a few of them.
- **P9 failures fell on the 2 flagged public letters** (21 to 17 and 24 to 9 lines), after the judge rubric changes (`4b8230e`, `be0beaf`). P9 still fails on all 8 letters.
- **Manchester is still blocked.** The judge answered every batch, so the block comes from the lines, not the providers. The last try missed 3 key facts, and P10 failed on 7 lines on that try.
- **Rule counts moved both ways.** P2 passes on 2 fewer letters, P3 and P4 on 1 fewer each, and P5 on 1 more. Each letter gets 3 tries from a model that does not answer the same way twice, so on 8 letters a change of 1 or 2 letters may be run-to-run variation. 2 runs can't tell.

The first run (11 November 2026, `fixtures/results/20261111T164114Z-all.json`) used the free Groq and OpenRouter chains. 6 of its 8 letters stopped with a provider or model-output error, and only 2 invented letters finished, both flagged.

## What fails, and why

- **P9 (meaning) fails on every letter**, on 1 to 26 lines. Earlier recorded samples show the judge failing lines for plain swaps of legal words and for shortened official names. Some of those are real meaning changes and some are the judge being stricter than its rubric.
- **P3, P4 and P5 are the main checker failures.** These are lines the model wrote: "... if you can" and "when you ..." clauses, copied passives, and letter words left in.
- **Blocks come from missing key facts.** Both blocked letters missed key facts on all 3 tries. The rules were not relaxed to change that.

## Changes since the a8d723d run

These are all in `66a8d0b`, so they are in this run's numbers.

- **Long letters.** The rewrite goes in parts of up to 60 sentences (`750a945`), and each part gets the letter's first and last sentences as context (`f42c83e`). The judge goes in batches of whole sentences, up to 40 lines each (`2f13fcb`). If a judge batch fails, only its unanswered lines are skipped (`4d81c75`).
- **Checker.** P5 and P7 pass X placeholders copied from a template letter and address lines before a key-fact postcode (`4023e6f`), and address words only when the Original has them (`c69682f`). Key facts: an action stops at a lone spaced dash (`d21042c`, `8f07e43`), and a heading question is not an action (`d21042c`). Each has regression and still-fails tests.
- **Prompts and plain words.** Worked examples for "if you can", "when" and "if" at the end of a line, "Then" only after "Maybe", template blanks and capitals for emphasis (`4b8230e`). The judge passes plain swaps for official words, shortened official names, repeated facts, correct definitions of hard words, and "Maybe" and "Then" for "if" (`4b8230e`, `be0beaf`). 7 plain-word swaps added (`7a96564`).
- **Access.** The model routes need a judge access key when `ACCESS_KEY` is set (`a98181c`, `22d9ef7`). The fixture script calls the pipeline directly, so this does not change the run.

## Changes after this run

- **Checker.** Hypothesis found a sentence where spaCy tagged an amount with a thousands comma as a verb, so the first of 2 payments in one sentence lost its amount and date, and swapping the dates between the 2 payments passed P1. The action now keeps that amount (`657bd8f`). This fix has not had a live fixture run. The recorded samples give the same P1 to P8 counts after the fix.

## Re-recorded samples

The public samples were re-recorded on Bedrock on `66a8d0b` straight after this run (`a107eeb`). East Cambridgeshire and the planning letter ended flagged. Manchester was blocked on P1 on all 3 tries, twice, so its 11 November recording is kept. 0 public letters pass all 10 rules. `checker/scripts/recheck_samples.py` gives the same P1 to P8 counts as the recorded checks. Per-rule counts are in `web/data/samples/README.md`.
