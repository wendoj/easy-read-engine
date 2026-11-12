# Recorded sample letters

The "Try a sample letter" list on the input screen loads results from this folder (task 29, design "Protecting the live quota"). Visitors can see the full flow without spending model quota.

## What is stored here

One JSON file per letter, `<id>.json`, with:

- `id`, `label`: the list entry
- `source`: the fixture file in `fixtures/letters/`
- `recordedAt`: when it was recorded (ISO 8601)
- `models`: every `provider:model` that answered, writing models first
- `result`: the full `ConversionResult`, including the Original text and the Easy Read lines

`index.ts` imports every JSON file here. The record script rewrites it; don't edit it by hand. The schema is `sampleFileSchema` in `web/src/samples/sample.ts`, and `web/tests/samples.test.ts` checks every file against it.

## Why storing letter text is allowed here

`safety.md` bans storing or logging user letters (R7.4). These files hold only the public sample letters from `fixtures/letters/`: blank templates and samples published by councils and the Planning Inspectorate, with placeholders instead of personal data (see `fixtures/letters/README.md`). Never add a user letter, a real letter or an invented letter here.

## Recording

Start the checker, then run the script from `web/`:

```
cd checker && uv run uvicorn http_app:app --app-dir src
cd web && npm run record-samples
```

The script runs each public sample letter through the real pipeline, one at a time, with a 60-second pause between letters (`SAMPLE_DELAY_MS`). It saves a letter only when the result is passed or flagged. A blocked result or an error is retried once after the pause, then reported and skipped; an earlier recording of that letter is kept.

## Loading a sample

`POST /api/sample` with `{ "id": "<id>" }` re-runs P1 to P8 on the recorded lines through the checker, so the checks shown are current. It makes no model call, so it spends no model quota and isn't under the model rate limits. P9 and P10 are the recorded judge verdicts. The result screen shows "Recorded on <date> with <model>" and says that P9 and P10 are from the recording. If the checker is down the route returns 503, as for every result.

## Current state

On 12 November 2026, on the final code (`66a8d0b`), East Cambridgeshire and the planning letter were re-recorded on Bedrock, both flagged after 3 tries. Manchester was blocked on P1 on all 3 tries, twice (the first run and the retry), so its 11 November recording is kept. No sample passes all 10 rules. Failing lines per rule on the files as committed (P1 to P8 from `recheck_samples.py`, which match the recorded checks exactly; P9 and P10 from the recorded checks):

| Sample | Lines | P2 | P3 | P4 | P5 | P6 | P7 | P9 | P10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| East Cambridgeshire (12 Nov, `66a8d0b`) | 109 | 1 | 1 | 4 | 5 | 0 | 1 | 23 | 0 |
| Manchester (11 Nov) | 122 | 0 | 8 | 0 | 3 | 0 | 2 | 52 | 0 |
| Planning appeal (12 Nov, `66a8d0b`) | 70 | 0 | 3 | 8 | 4 | 0 | 1 | 5 | 0 |

P1 and P8 pass on all 3. Compared with the `58055db` recordings, East Cambridgeshire went from 131 to 109 lines and from 47 to 35 failing lines over P2 to P10, with fewer checker failures and more P9 failures (8 to 23). The planning letter went from 67 to 70 lines and from 17 to 21 failing lines, with more P3, P4 and P5 failures and fewer P9 failures (10 to 5). Each recording is 1 run of a model that does not answer the same way twice.

The 11 November history follows.

A re-record (`40faaee`) after the P3/P5 checker fixes, the judge's sibling-line context and the worked examples in `prompts/rewrite.md` and `prompts/regenerate.md` cut failing lines across the 3 letters from 190 to 103. Both numbers are failing line IDs summed over all 10 rules in each file's recorded `checks`, comparing the `24116c8` recordings with the `40faaee` ones. Prompts, checker and model answers all changed in that re-record, so the drop is not a measure of the prompts alone. `checker/scripts/recheck_samples.py` re-checks P1 to P8 on the current files with the current checker; `docs/kiro-usage.md` gives those numbers. It also exits 1 when a sample's sentence IDs or texts no longer match the current sentence split, which is when the app refuses the sample with `sample_outdated`. Then re-record with `npm run record-samples`; never edit the IDs by hand. Most of what remains is "If …, …" lines (P3), passives (P4) and legal words such as "representations" and "determine" (P5).

Earlier runs failed in two ways:

- `model_output_invalid`: the judge and regenerate replies on long letters hit their `max_tokens` cap (`finish_reason: "length"`) and were cut off mid-JSON. Bedrock requests now use `BEDROCK_MAX_TOKENS` and `BEDROCK_TIMEOUT_MS` (`src/llm/client.ts`).
- Blocked by P1: the checker merged PDF layout lines (labels, table cells, headings) into long sentences and found "actions" in them that no rewrite could keep. `checker/src/checks/sentences.py` now ends a sentence at a layout line break.

When a letter fails, the script prints the field paths that were wrong.
