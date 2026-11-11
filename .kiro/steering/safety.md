---
inclusion: always
---

# Safety

These rules apply to code, prompts, tests, fixtures and logs. They come from Requirements 2 and 7 in `.kiro/specs/easy-read/requirements.md`.

## Never give advice (R7.2, R7.3)

- Easy Read output says what the letter says. It never says what the reader should decide, whether to appeal, pay, agree or get help, unless the letter itself says so.
- Every prompt that writes Easy Read lines (`rewrite.md`, `regenerate.md`) must include this rule.
- The P10 judge checks every line for advice. Advice is a P10 failure, handled like any other failure: regenerate, then flag. Never pass it silently.

## Always keep and show the original (R5.1, R7.1)

- The Original is shown on the left of every result screen, including the blocked state.
- Every output, on screen and in the exported PDF, states that it is a simplified version and that the original letter is the official one. On screen this notice can't be dismissed.
- Never drop or rewrite the Original. The confirmed text is the only source for later steps (R1.6).

## Flag numbers and key facts (R2, P1)

- Key facts are dates, times, money amounts, reference numbers, phone numbers, addresses and required actions.
- Extract key facts from the Original before conversion. P1 compares the output with the Original, never with the model's own output.
- Every key fact must appear in the output with an identical normalised value. Don't round, reformat into a different value, or "fix" a number.
- If P1 fails after 3 tries, or after a user edit, block the output: return no lines, show which key fact failed, and disable export.
- Never hide a failed rule. If any other rule still fails after 3 tries, show the output with that rule flagged.
- Highlight key facts in both columns so the reader can check them.
- Never show output that hasn't been checked. If the checker service is down, return 503.

## Never store or log letter text (R7.4)

- Process letters in memory. No database, no files, no caches that hold letter content. The only volume is the pictogram image cache.
- Never log letter text, extracted text, Easy Read lines or key-fact values. That includes request bodies, error messages and test failure output on real letters. Log only rule results, attempt counts, timings and which provider and model answered.
- Fixtures use public sample letters and invented letters only, with no real personal data.
- Before conversion, tell the user the text goes to an outside AI model provider and ask them not to upload letters with personal details (R7.5).
- API keys stay in environment variables, never in code, prompts or logs. Model chains list only `bedrock:` and `groq:` entries. Bedrock is called in-Region (`AWS_REGION`, default `eu-west-2`), never through a cross-Region inference profile.
