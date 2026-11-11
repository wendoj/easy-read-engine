---
name: check-easy-read
description: Check Easy Read lines written from an official letter (the Original) with the deterministic Easy Read checker. Use when writing, reviewing or editing Easy Read text, or a prompt that produces it, and you need to prove that key facts are unchanged and rules P1 to P8 pass.
---

# Check Easy Read text

The `easy-read-checker` MCP server runs rules P1 to P8 without a model, so the same input always gives the same result. P9 (meaning kept) and P10 (tone and no advice) need a model judge. They are not in this server, so check them yourself with the tone rules below.

The full rule table, with examples, is in `references/rules.md`.

## Step 1: Get the key facts from the Original

Call `extract_key_facts` with the Original letter text:

```json
{ "text": "<the Original>" }
```

It returns a list of key facts: dates, times, money amounts, reference numbers, phone numbers, addresses and required actions. Each has `id`, `type`, `value`, `normalised`, `start`, `end` and `sentence_id`.

- Always extract from the Original. Never extract from the Easy Read lines, or P1 will compare the output with itself.
- The checker numbers the Original's sentences `s1`, `s2`, ... in order. Each key fact's `sentence_id` says which sentence it is in. Use these IDs as each line's `source_sentence_id`. A sentence with no key facts still has its number in the sequence.
- The Original can be at most 20,000 characters.

## Step 2: Write the lines

Each line is an object:

```json
{ "id": "l1", "text": "The council got your form.", "source_sentence_id": "s1", "symbol_id": null }
```

- One idea per line. Each line keeps the ID of the Original sentence it came from.
- Keep every key fact with the same value. A required action may be split over lines from the same source sentence, but keep its verb and its object.
- Follow the rules in `references/rules.md` and the tone rules below.

## Step 3: Run the checks

Call `check_easy_read` with the Original, the key facts from step 1 (unchanged) and the lines:

```json
{ "original": "<the Original>", "key_facts": [ ... ], "lines": [ ... ] }
```

It returns one result per rule, P1 to P8, in order. Each result has `rule`, `passed`, `line_ids` (the lines that failed), `failed_fact_ids` (P1 only) and `details`.

- If P1 fails, a key fact is missing or changed. Treat the output as blocked: fix the named fact before anything else. Never round, reformat or "fix" a number.
- For any other failure, rewrite only the lines in `line_ids` and run the check again.
- Never hide a failed rule. If a rule still fails after 3 tries, report it as failed.

## Step 4: Pick pictures

For each line, call `find_symbol` with a short plain phrase for the line's main idea:

```json
{ "query": "pay money", "limit": 5 }
```

It returns pictogram IDs from the ARASAAC index, best first. Put the chosen `id` in the line's `symbol_id`. An empty list means no picture fits, so set `symbol_id` to `null`. Never make up or guess an ID: P8 fails on any ID that is not in the index.

ARASAAC pictograms are licensed CC BY-NC-SA (author Sergio Palao, owner Government of Aragón). Show that attribution wherever the pictures appear, and don't use them in a commercial product without permission.

## Tone and advice (P10, check these yourself)

**Respectful, not childish.** The reader is an adult.

- No baby talk, no "Well done!", no exclamation marks to sound friendly.
- Don't use "simple", "easy", "just" or "don't worry".
- Say hard news plainly. Don't soften it until it changes meaning.

**No advice.** Say what the letter says. Never say what the reader should decide, or whether to appeal, pay, agree or get help, unless the letter says so.

| Allowed: what the letter says | Not allowed: advice |
| --- | --- |
| The letter says you must pay £45 by 1 April 2026. | You should pay this quickly. |
| The letter says you can ask the council to look again at this decision. | You should appeal this decision. |

## Privacy

Don't paste real letters with personal details into a chat. Use public sample letters or invented ones. The checker keeps nothing and logs no letter text, but the chat itself may be sent to a model provider.

## Worked example

Original (invented): "We have received your form and we will respond by 14 March 2026. You must pay the outstanding balance of £45 by 1 April 2026."

These lines pass P1 to P8 with the key facts from step 1:

| id | source_sentence_id | text |
| --- | --- | --- |
| l1 | s1 | The council got your form. |
| l2 | s1 | The council will reply by 14 March 2026. |
| l3 | s2 | You must pay the balance of £45. |
| l4 | s2 | Pay it by 1 April 2026. |

"You must pay £45." on its own fails P1, because the action's object ("balance") is gone.
