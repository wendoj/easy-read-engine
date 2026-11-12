# Requirements Document

## Introduction

Easy Read Engine turns an official letter (from a council, the NHS or the benefits system) into a faithful Easy Read version. It proves the output is correct with automated checks rather than trusting the model: a generative model is combined with a deterministic rule checker, a property-based test suite and a pictogram library.

**Audience:** people with learning disabilities, low literacy or English as a second language, and the carers and support workers who read letters with them.

**Core promise:** every output passes a published set of Easy Read rules, and every date, amount and instruction in the original appears unchanged in the output.

**In scope:** paste text or upload a PDF or photo; Easy Read output beside the original, one idea per line with a picture per idea; a rule report; key facts highlighted and traced to the original; export to PDF.

**Out of scope:** user accounts, translation into other languages, handwriting, and any advice about what the letter means for the reader.

Source: `docs/brief.md`.

## Glossary

- **System:** the Easy Read Engine (frontend, API and checkers together).
- **Original:** the letter text after extraction and user confirmation.
- **Easy Read output:** the converted version, made of Lines.
- **Key fact:** a value from the Original that must not change. Types: date, time, money amount, reference number, phone number, address, required action.
- **Line:** one idea in the Easy Read output, with its text, its source sentence in the Original, and an optional symbol ID.
- **Rule set:** the correctness properties P1 to P10 listed below.
- **Check result:** for one rule, pass or fail and the IDs of the Lines it applied to.
- **Symbol library:** a licensed pictogram library with a searchable symbol index.

## Requirements

### Requirement 1: Input

**User Story:** As a reader or support worker, I want to paste, or upload a PDF or photo of, a letter, so that I can get an Easy Read version without retyping it.

#### Acceptance Criteria

1. WHEN the user pastes text, THE System SHALL show the text for confirmation before converting.
2. WHEN the user uploads a typed PDF, THE System SHALL extract its text and show it for confirmation before converting.
3. WHEN the user uploads a clear photo of a printed letter, THE System SHALL extract its text and show it for confirmation before converting.
4. IF the uploaded letter is handwritten, THEN THE System SHALL reject it and show a message saying handwriting is not supported.
5. WHILE the extracted text is shown for confirmation, THE System SHALL let the user correct it before conversion.
6. THE System SHALL use the confirmed text as the Original for all later steps.
7. IF the confirmed text is longer than 1,500 words, THEN THE System SHALL NOT convert it, and SHALL show a message giving the limit. (The limit comes from the free model tier; see `design.md`.)

### Requirement 2: Faithfulness

**User Story:** As a reader, I want every date, amount and instruction in my letter to stay exactly the same, so that I do not miss a deadline or pay the wrong amount.

#### Acceptance Criteria

1. THE System SHALL extract every Key fact from the Original before conversion begins.
2. THE System SHALL record each Key fact's type, value and position in the Original.
3. THE System SHALL include each Key fact in the Easy Read output with a value identical to the one in the Original.
4. THE System SHALL compare Key facts in the output against those extracted from the Original, not against the model's own output (P1).
5. IF a Key fact is missing from the output or has a changed value, THEN THE System SHALL block the output and show which Key fact failed.
6. WHERE a Key fact is a required action, THE System SHALL treat it as identical when the output keeps the same verb, the same object, and every date or amount inside the action. (This is a first version; see "Planned expansion" in `design.md`.)

### Requirement 3: Easy Read rules

**User Story:** As a reader, I want the output to follow Easy Read rules, so that I can understand it.

#### Acceptance Criteria

1. THE System SHALL check every Easy Read output against every rule in the Rule set before showing it.
2. THE System SHALL only show output that passes every rule in the Rule set, except as allowed by criterion 4.
3. WHEN a rule fails, THE System SHALL regenerate only the failing Lines and check again, up to 3 attempts.
4. IF a rule other than P1 still fails after 3 attempts, THEN THE System SHALL show the output with that rule flagged, and SHALL NOT hide the failure. On screen, the flag is the pass count and the check report, which names each failed rule and the Lines it failed on. In print and PDF, it is a Checks section at the end that names each failed rule and the start of each Line it failed on. The Lines themselves carry no failure marker.
5. IF P1 still fails after 3 attempts, THEN THE System SHALL block the output as stated in Requirement 2.
6. WHEN P9 or P10 fails, THE System SHALL treat it like any other rule failure: regenerate the failing Lines within the same 3 attempts, then flag the rule if it still fails.

### Requirement 4: Pictures

**User Story:** As a reader, I want a picture beside each idea, so that I can follow the letter more easily.

#### Acceptance Criteria

1. THE System SHALL place one picture beside each Line, chosen from the licensed Symbol library.
2. WHERE no suitable picture exists for a Line, THE System SHALL show the Line without a picture rather than with a wrong one.
3. THE System SHALL only use symbol IDs that exist in the Symbol library index (P8).
4. THE System SHALL show the Symbol library's attribution and licence on screen and in every exported PDF.

### Requirement 5: Side by side

**User Story:** As a reader or support worker, I want to see the original and the Easy Read version together, so that I can check one against the other.

#### Acceptance Criteria

1. THE System SHALL show the Original and the Easy Read output side by side, with the Original on the left.
2. WHEN the user selects an Easy Read Line, THE System SHALL highlight the sentence in the Original that the Line came from.
3. THE System SHALL highlight Key facts in both the Original and the Easy Read output.

### Requirement 6: Rule report

**User Story:** As a support worker, I want to see which checks passed, so that I can trust the output or know what to look at.

#### Acceptance Criteria

1. THE System SHALL show a report listing each rule in the Rule set, its result, and the Lines it applied to.
2. THE System SHALL show a pass count at the top of the main screen, for example "10 of 10 checks passed".
3. WHEN the user selects the pass count, THE System SHALL open the rule report.

### Requirement 7: Safety

**User Story:** As a reader, I want to know the Easy Read version is not the official letter, so that I still rely on the original for decisions.

#### Acceptance Criteria

1. THE System SHALL state on every Easy Read output, on screen and in export, that it is a simplified version and that the original letter is the official one.
2. THE System SHALL NOT give advice or say what the reader should decide.
3. THE System SHALL check every output for advice as part of P10, and SHALL treat advice as a P10 failure.
4. THE System SHALL process letters in memory and SHALL NOT store letter content.
5. THE System SHALL tell the user, before conversion, that the letter text is sent to an outside AI model provider, and ask them not to upload letters with personal details.

### Requirement 8: Export

**User Story:** As a support worker, I want to print the Easy Read version, so that the reader can keep it with the original letter.

#### Acceptance Criteria

1. WHEN the user selects Export, THE System SHALL produce a printable A4 PDF.
2. THE System SHALL lay out the PDF in Easy Read format: large text, pictures on the left, one idea per line.
3. THE System SHALL include the statement from Requirement 7 in the exported PDF.

### Requirement 9: Edit and recheck

**User Story:** As a support worker, I want to edit an Easy Read line and have it checked again, so that I can fix wording without breaking a fact or a rule.

#### Acceptance Criteria

1. THE System SHALL let the user edit the text of any Easy Read Line.
2. WHEN the user saves an edit, THE System SHALL re-run P1 to P8 on the whole output, re-run P9 and P10 on the edited Lines, and update the rule report and pass count.
3. IF an edit makes P1 fail, THEN THE System SHALL block the output as stated in Requirement 2, show which Key fact failed, and let the user undo the edit.
4. IF an edit makes any other rule fail, THEN THE System SHALL flag that rule as stated in Requirement 3.
5. WHILE the output is blocked, THE System SHALL NOT allow export.

## Correctness Properties

The Rule set used by Requirements 2, 3, 6, 7 and 9. P1 to P8 run without an LLM. Thresholds are starting values to tune against real Easy Read documents, not published limits.

| # | Property | How it is checked | Automatic? |
| --- | --- | --- | --- |
| P1 | Every Key fact in the Original appears unchanged in the output | Regex and NER extraction on both sides, then set comparison | Yes |
| P2 | No sentence is longer than 15 words | Sentence split and word count | Yes |
| P3 | One idea per sentence | No more than one main verb clause, from a dependency parse | Yes, approximate |
| P4 | No passive voice | Dependency parse looks for passive auxiliaries | Yes |
| P5 | Plain words | Every word is in a common-word list, or is defined on first use | Yes |
| P6 | Numbers are written as digits | No spelled-out numbers such as "twenty" | Yes |
| P7 | No unexplained abbreviations | Every all-caps token is expanded on first use | Yes |
| P8 | Every Line with a picture has a valid symbol ID from the library | Lookup against the symbol index | Yes |
| P9 | Output keeps the Original's meaning | LLM judge compares each Line with its source sentence | No |
| P10 | Tone is respectful, not childish, and gives no advice | LLM judge against a rubric | No |

### Property-based testing

1. P1 to P8 SHALL be written as properties with Hypothesis.
2. A generator SHALL produce synthetic letters with random dates, amounts, reference numbers, and long, passive sentences. For every generated letter, the pipeline's output SHALL satisfy P1 to P8.
3. Checker tests SHALL confirm each checker fails on bad input, for example a 16-word sentence fails P2 and a passive sentence fails P4.
4. A mutation test SHALL change one date or amount in an output and confirm P1 fails.
5. The orchestration in the Next.js route handlers (retry loop, block and flag decisions) SHALL be tested with fast-check.
