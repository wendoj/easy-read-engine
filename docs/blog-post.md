> **DRAFT.** For you to edit before publishing. Every fact here comes from this repository. Check the numbers again if the code or results change.

# Easy Read Engine: letters you can check, not just trust

Councils, the NHS and the benefits system send letters that many people can't read. Easy Read versions use short sentences, plain words and a picture for each idea. They are made by hand, so most letters never get one.

Easy Read Engine turns an official letter into Easy Read. It is for adults with learning disabilities, low literacy or English as a second language, and for the carers and support workers who read letters with them.

A language model can rewrite a letter in a few seconds. The hard part is trusting the result. If a model changes a date or an amount, someone could miss a deadline or pay the wrong amount. So the project is built around checks the model can't talk its way past.

## What it does

You paste a letter, upload a typed PDF or take a photo. You check the text, then convert it. The Easy Read version appears next to the original. Select a line and the sentence it came from is highlighted. Dates, amounts, reference numbers and other key facts are highlighted in both.

Every result says it is a simplified version and that the original letter is the official one. The Easy Read version says what the letter says. It never tells the reader what to decide.

## The rules

Each line is checked against 10 rules, P1 to P10. They follow 2 published guides: Inclusion Europe's "Information for all" standards and the Department of Health's 2010 guidance on Easy Read.

- P1: every date, time, amount, reference number, phone number, address and required action in the letter appears unchanged.
- P2 to P7: short sentences, one idea each, active voice, plain words, numbers as digits, abbreviations explained.
- P8: every picture is a real pictogram from the ARASAAC library.
- P9 and P10: a model judge checks that each line keeps its meaning, and that the tone is respectful and gives no advice.

P1 to P8 run in a Python checker with spaCy and no model, so the same input always gives the same result.

## How the checks gate the model

Key facts are taken from the original before the model writes anything. Then the model writes lines, the checker runs, and failed lines are written again, up to 3 tries.

- If a key fact is still missing or changed, the output is blocked. No lines are shown, the failed fact is named and export is turned off.
- If another rule still fails, the output is shown with that rule flagged. A failure is never hidden.
- If the checker is down, nothing is shown.

You can edit any line. Change a date and the checker runs again: P1 fails and the output is blocked until you undo the edit.

## Stitched together

This is a Frankenstein project. It joins a language model (Amazon Bedrock in London, Groq as a fallback), spaCy dependency parsing, the ARASAAC pictogram library, property tests with Hypothesis and fast-check, and headless Chromium for PDF export. The model writes. The deterministic parts decide what the reader sees.

## How Kiro helped

The spec came first: 9 requirements, 47 acceptance criteria and 36 tasks. Steering files kept the Easy Read and safety rules in every session. Hooks commit each task, run a checker's tests when it is saved, and fail a task if a property test is removed or skipped. One property test found a real bug: the sentence splitter could cut a phone number in 2.

The checker is also an MCP server, and a Kiro Power packages it with the rules, so any Kiro project can run the same checks.

## Where it stands

The results so far are partial. In a run of 8 fixture letters on free-tier providers, 2 finished and both were flagged, and 6 stopped on provider errors. A full run on Bedrock is next. No output has been reviewed by an Easy Read reader or writer yet, and both guides say that testing with readers matters.

[Add a quote from an Easy Read reviewer here]

[Add the live URL and the repository link here]
