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

The last recording run (see the task 29 report) saved no samples: Groq returned invalid output or rate-limit errors and the OpenRouter fallbacks failed for all 3 letters. The list is hidden while this folder holds no samples. Run `npm run record-samples` again when the providers answer.
