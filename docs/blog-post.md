> **DRAFT.** Edit before publishing. Check the numbers again if the code or results change.

# Easy Read Engine: letters you can check, not just trust

Councils, the NHS and the benefits system send letters that many people can't read. Easy Read versions use short sentences, plain words and a picture for each idea. People write them by hand, so most letters never get one.

Easy Read Engine turns an official letter into Easy Read. It is for adults with learning disabilities, low literacy or English as a second language, and for the carers who read letters with them.

A language model rewrites a letter in seconds. If it changes a date or an amount, someone misses a deadline or pays the wrong sum. So the model writes, and checks it cannot talk its way past decide what the reader sees.

## What it does

Paste a letter, upload a typed PDF or take a photo. Check the text, then convert it. The Easy Read version appears next to the original. Select a line and its source sentence lights up. Dates, amounts, reference numbers and other key facts are highlighted in both columns.

Every result says it is a simplified version and that the original letter is the official one. The Easy Read lines say what the letter says. They never tell the reader what to decide.

## The 10 rules

Each line is checked against rules P1 to P10, which follow Inclusion Europe's "Information for all" standards and the Department of Health's 2010 Easy Read guidance.

- **P1:** every date, time, amount, reference number, phone number, address and required action in the letter appears unchanged.
- **P2 to P7:** short sentences, one idea each, active voice, plain words, numbers as digits, abbreviations explained.
- **P8:** every picture is a real pictogram from the ARASAAC library.
- **P9 and P10:** a model judge checks that each line keeps its meaning, keeps a respectful tone and gives no advice.

P1 to P8 run in a Python checker with spaCy and no model, so the same input gives the same result.

## How the checks gate the model

The checker takes the key facts from the original before the model writes anything. The model writes lines, the checker runs, and failed lines are rewritten, up to 3 tries.

- If no try keeps every key fact, the output is blocked: no lines, the failed fact named, export off. If only the last try broke a fact, the latest try that kept them all is shown.
- If another rule still fails, the output is shown with that rule flagged.
- If the checker is down, nothing is shown.

You can edit any line. Change a date and the checker runs again. P1 fails and the output stays blocked until you undo the edit.

## How Kiro helped

The spec came first: 9 requirements, 47 acceptance criteria and 36 tasks. Steering files kept the Easy Read and safety rules in every session. Hooks commit each task, run a checker's tests on save, and fail a task if a property test is removed or skipped. One property test found a real bug: the sentence splitter could cut a phone number in 2. The checker is also an MCP server, so Kiro calls the same checks.

## Where it stands

No letter has passed all 10 rules in a full run. In the 8-letter run on 13 November 2026 (`docs/pass-rates.md`), 6 letters ended flagged and 2 blocked on P1. The meaning check (P9) passed on 3 of the 8 letters, up from none the day before, after I tuned the judge rubric.

The checker caused both blocks. It read a heading ("Council Tax reminder notice") as a command, treated a list of things the council could do as orders to the reader, and read "Monday—Friday" and "Monday to Friday" as different dates. I fixed each with a regression test, and P1 still compares every fact. After the fixes, the invented council tax letter passed all 10 rules once, and Manchester ended flagged instead of blocked. Those are single runs, and the latest change (splitting "if" and ", and" clauses in code for P3) has had no live run.

One Easy Read checker tried the app and said it was easy to use and helped a lot. That is one informal check. Testing with readers, which both guides ask for, has not happened.

[Add the live URL and the repository link. The app is not deployed yet.]
