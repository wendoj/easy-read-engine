## Overview

Easy Read Engine turns an official letter into a faithful Easy Read version, and proves it with automated checks rather than trusting the model. It is entered in the **Frankenstein** category: a generative model stitched to a deterministic rule checker, a property-based test suite and a pictogram library.

**Problem.** Councils, the NHS and the benefits system send letters many people cannot read. Easy Read versions are made by hand, so most letters never get one.

**Audience.** People with learning disabilities, low literacy or English as a second language, and the carers and support workers who read letters with them.

**Core promise.** Every output passes a published set of Easy Read rules, and every date, amount and instruction in the original appears unchanged in the output.

**In scope for the 7-day build**

- Paste text or upload a PDF or photo of a letter
- Easy Read output beside the original, one idea per line, a picture per idea
- A rule report showing which checks passed
- Highlighted key facts (dates, money, actions) traced back to the original
- Export to PDF

**Out of scope:** user accounts, translation into other languages, handwriting, and any advice about what the letter means for the reader.

## Requirements

Eight requirements, written in the EARS form Kiro uses, so they can go straight into `.kiro/specs/easy-read/requirements.md`. R2 and R3 carry most of the judging story.

**R1 Input.** WHEN the user pastes text or uploads a PDF or photo of a letter, THE SYSTEM SHALL extract its text and show it for confirmation before converting.

- Typed PDFs and clear photos of printed letters are supported; handwriting is rejected with a message
- The user can correct the extracted text before conversion

**R2 Faithfulness.** THE SYSTEM SHALL preserve every key fact in the original: dates, times, money amounts, reference numbers, phone numbers, addresses and required actions.

- Each key fact is extracted from the original before conversion
- Each key fact appears in the output with an identical value
- IF a key fact is missing or changed, THEN THE SYSTEM SHALL block the output and show which fact failed

**R3 Easy Read rules.** THE SYSTEM SHALL only show output that passes every rule in the rule set (see Correctness properties).

- WHEN a rule fails, THE SYSTEM SHALL regenerate the failing lines, up to 3 attempts
- IF a rule still fails after 3 attempts, THEN THE SYSTEM SHALL show the output with that rule flagged, never hidden

**R4 Pictures.** THE SYSTEM SHALL place one picture beside each idea, chosen from a licensed symbol library.

- WHERE no suitable picture exists, the line is shown without one rather than with a wrong one

**R5 Side by side.** THE SYSTEM SHALL show the original and the Easy Read version side by side, and WHEN the user selects an Easy Read line, highlight the sentence it came from.

**R6 Rule report.** THE SYSTEM SHALL show a report listing each rule, its result and the lines it applied to.

**R7 Safety.** THE SYSTEM SHALL state on every output that it is a simplified version and that the original letter is the official one.

- THE SYSTEM SHALL NOT give advice or say what the reader should decide

**R8 Export.** WHEN the user selects Export, THE SYSTEM SHALL produce a printable A4 PDF in Easy Read layout: large text, pictures on the left, one idea per line.

## Design

The pipeline checks before it shows: the rewrite loops through the checkers until every rule passes or three tries are used up.

&#91;embedded content: conversion pipeline · 9 steps, 1 retry loop\]

Key facts are pulled from the original before the rewrite, so P1 compares against the source, not against the model's own output.

**Stack**

| Part | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js, TypeScript | Your existing stack |
| API | Fastify, TypeScript | Your existing stack |
| Checkers | Python with spaCy, served over HTTP and as the MCP server | Dependency parsing for P3 and P4 is mature in Python |
| Property tests | Hypothesis for the checkers, fast-check for the API | One property-test library per language |
| Text extraction | pdf.js for typed PDFs, a vision model for photos | Typed PDFs need no model |
| PDF export | HTML to PDF in a headless browser | Same layout as the screen |

**Data model**

- `KeyFact`: type (date, money, reference, phone, address, action), value, position in the original
- `Line`: Easy Read text, source sentence, symbol ID
- `CheckResult`: rule, pass or fail, line IDs affected

**Main screen.** Original on the left, Easy Read on the right with a picture beside each line, key facts highlighted in both columns, and the rule report in a panel that opens from a pass count at the top ("10 of 10 checks passed").

## Correctness properties

Eight of these ten checks run without an LLM, which clears the day-1 bar of seven. The thresholds are starting values to tune against real Easy Read documents, not published limits.

| # | Property | How it is checked | Automatic? |
| --- | --- | --- | --- |
| P1 | Every key fact in the original appears unchanged in the output | Regex and NER extraction on both sides, then set comparison | Yes |
| P2 | No sentence is longer than 15 words | Sentence split and word count | Yes |
| P3 | One idea per sentence | No more than one main verb clause, from a dependency parse | Yes, approximate |
| P4 | No passive voice | Dependency parse looks for passive auxiliaries | Yes |
| P5 | Plain words | Every word is in a common-word list, or is defined on first use | Yes |
| P6 | Numbers are written as digits | No spelled-out numbers like "twenty" | Yes |
| P7 | No unexplained abbreviations | Every all-caps token is expanded on first use | Yes |
| P8 | Every line with a picture has a valid symbol ID from the library | Lookup against the symbol index | Yes |
| P9 | Output keeps the original's meaning | LLM judge compares each line with its source sentence | No |
| P10 | Tone is respectful, not childish | LLM judge against a rubric | No |

**Property-based testing.** P1 to P8 are written as properties with Hypothesis, since the checkers are in Python. A generator produces synthetic letters with random dates, amounts, reference numbers and long, passive sentences. For every generated letter, the pipeline's output must satisfy all eight properties. A second set of tests checks the checkers themselves: a sentence of 16 words must fail P2, a passive sentence must fail P4.

**Mutation check on P1.** Change one date or amount in an output and confirm P1 fails. This is the strongest single demo of why the checks matter.

## Kiro setup

Each Kiro feature has one job here, so the write-up can say exactly what it changed. Check the current Kiro docs for hook trigger names and the powers format before building; I have not verified them.

| Feature | File or config | What it does |
| --- | --- | --- |
| Spec | `.kiro/specs/easy-read/` (requirements, design, tasks) | The requirements and properties above, implemented task by task |
| Steering | `.kiro/steering/easy-read-rules.md` | The Easy Read rules in plain language, so every prompt Kiro writes follows them |
| Steering | `.kiro/steering/safety.md` | Never give advice; always keep the original; flag numbers |
| Steering | `.kiro/steering/tech.md` | Stack, folder layout, test commands |
| Hook | On save in `src/checks/` | Runs the property tests for that checker |
| Hook | On save in `prompts/` | Converts 5 fixture letters and runs all 10 checks, so a prompt change that breaks a rule is caught at once |
| Hook | Before a task is marked done | Fails if any property test is skipped or deleted |
| MCP | Local server: `check_easy_read`, `extract_key_facts`, `find_symbol` | Lets Kiro call the real checkers and symbol search while it writes code and prompts |
| Power | Package the MCP server and steering | Lets anyone add Easy Read checks to their own Kiro project; this is the reuse story |

**Write-up angle.** Compare the first day of vibe-coded prompts with the spec-driven version: count how many fixture letters passed all checks before and after the steering and hooks went in.

## Tasks

Day 1 decides whether the project goes ahead; days 2 to 7 build it. Each day ends with something that runs.

**Day 1: go/no-go**

- [ ] Write the Easy Read rules into the steering doc
- [ ] Implement P1, P2 and P4 as plain functions with fast-check tests
- [ ] Run 3 real council letters through one prompt and score them
- [ ] Show one output to someone who uses or makes Easy Read
- [ ] **Decision:** go if at least 7 of the 10 properties are automatic and the output is judged usable; otherwise switch ideas

**Day 2: checkers**

- [ ] Implement P3, P5, P6, P7 and P8
- [ ] Property tests for every checker, including the checker-must-fail cases
- [ ] Wrap the checkers as the MCP server

**Day 3: pipeline**

- [ ] Key-fact extraction, conversion, check, and regenerate-failing-lines loop (max 3 attempts)
- [ ] Text extraction from PDF and photo
- [ ] Set up the three hooks

**Day 4: pictures and layout**

- [ ] Symbol library search, one picture per idea
- [ ] Side-by-side view with line-to-source highlighting

**Day 5: report and export**

- [ ] Rule report panel
- [ ] Key facts highlighted in both columns
- [ ] A4 PDF export

**Day 6: polish and evidence**

- [ ] Design pass on the main screen
- [ ] Run 20 public sample letters; record pass rates
- [ ] Get feedback from 3 to 5 people and capture quotes

**Day 7: ship**

- [ ] Deploy and test the live URL
- [ ] Record the demo video (under 3 minutes)
- [ ] Write the Kiro usage write-up, README and licence; confirm `.kiro/` is committed
- [ ] Social post with #KiroweenHackathon26

## Risks, open questions and demo

The biggest risk is a changed fact reaching a reader, so P1 blocks output rather than warning.

| Risk | Effect | Mitigation |
| --- | --- | --- |
| A date or amount is changed | Someone misses a deadline or pays the wrong amount | P1 blocks the output; the original is always shown beside it |
| Meaning drifts without breaking any rule | Output looks fine but says something different | P9 judge per line; line-to-source highlighting so a reader can check |
| Symbol licence forbids this use | Pictures must be removed late | Pick the library on day 1 and record its licence in the README |
| Real letters contain personal data | Privacy and demo problems | Use only public sample letters and invented ones; process in memory, store nothing |
| An AI Easy Read tool already exists | Lower innovation score | Search before day 1; if one exists, lead with the verified checks, which it is unlikely to have |
| Judges see a text wrapper | Low design and impact scores | Polished side-by-side view, the rule report, and real feedback quotes |

**Open questions**

- Which symbol library allows this use? Check each candidate's licence.
- Which official Easy Read guidance will the steering doc follow? Cite it in the README.
- Who will review outputs: a support worker, a self-advocacy group, or a charity?

**Demo script (under 3 minutes)**

1. 0:00 to 0:20. A real-looking council letter on screen. "Many people can't read this. Easy Read versions are made by hand, so most letters never get one."
2. 0:20 to 1:10. Upload it. The Easy Read version appears beside it, with pictures. Click a line to show its source sentence.
3. 1:10 to 1:50. Open the rule report: every rule green. Change one date in the output live; P1 turns red and the output is blocked.
4. 1:50 to 2:30. Inside Kiro: the steering doc, a hook catching a broken prompt, the property tests running.
5. 2:30 to 3:00. Pass rate across 20 letters, one quote from a real reviewer, then the live URL.
