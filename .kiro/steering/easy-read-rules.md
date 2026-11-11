---
inclusion: always
---

# Easy Read rules

Follow these rules in every Easy Read line, every prompt in `prompts/`, and every example or fixture you write. Each rule matches a check in the Rule set (`.kiro/specs/easy-read/requirements.md`, "Correctness Properties"). P1 (key facts) is in `safety.md`.

## Guidance source

These rules follow two published guides. The README ("Easy Read guidance") maps each rule to the point it comes from.

- Inclusion Europe, [Information for all: European standards for making information easy to read and understand](https://www.inclusion-europe.eu/wp-content/uploads/2017/06/EN_Information_for_all.pdf) (2010). Cited below as "IE" with section and standard number.
- Department of Health, [Making written information easier to understand for people with learning disabilities](https://www.gov.uk/government/publications/making-written-information-easier-to-understand-for-people-with-learning-disabilities-guidance-for-people-who-commission-or-produce-easy-read-information-revised-edition-2010), revised edition 2010. Cited below as "DH" with the Annex A section.

| Rule | Source |
| --- | --- |
| P2 | IE 1.14 and 2.19 "Keep your sentences short". DH A6 "More than 15 words is harder to read" |
| P3 | IE 2.19 "writing only 1 idea per sentence" |
| P4 | IE 1.17 "Use active language rather than passive language where possible" |
| P5 | IE 1.6, 1.7 and 2.11. DH A3 "Explain difficult words the first time they appear" |
| P6 | IE 2.42 "Write numbers as digits". DH A4 "Express all numbers in figures, including 1 to 10" |
| P7 | IE 1.12 and 2.16. DH A3 "use the full title the first time" |
| P8 | IE 2.34 to 2.38 and DH A2 (pictures that match the text). Checking the ID against the index is this project's own rule |
| "you" | IE 1.15 "Speak to people directly" |
| Tone | IE 1.3 "do not use language for children when your information is for adults" |

The guides give advice, not pass or fail limits. The checks turn them into hard rules, and those limits are this project's choice. DH says more than 15 words is "harder to read"; making 15 words a hard limit is ours. Neither guide has a no-advice rule. That rule comes from `safety.md` (R7.2).

## Rules for each line

| Rule | Write it like this | Not like this |
| --- | --- | --- |
| **P2. Short sentences.** No more than 15 words in a sentence. | You need to pay £45. | Following our review of your account, you are now required to pay the outstanding balance of £45. |
| **P3. One idea per sentence.** One main verb clause. Split "and", "but", "because" and "if" clauses into separate lines. | The council got your form. The council will reply by 14 March 2026. | We have received your form and we will respond by 14 March 2026. |
| **P4. Active voice.** Say who does the action. No passive verbs. | The council will send you a letter. | A letter will be sent to you. |
| **P5. Plain words.** Use common, everyday words. If you must use a harder word, explain it the first time. | Your rent is the money you pay to live in your home. | Your rental liability has been reassessed. |
| **P6. Numbers as digits.** Write every number in digits. | You have 3 weeks. | You have three weeks. |
| **P7. Explain abbreviations.** Write the full words the first time, with the short form in brackets. Or don't use the short form. | Personal Independence Payment (PIP) | PIP |
| **P8. Real pictures only.** A picture must come from the symbol library index. If no picture fits, use no picture. | `symbol_id: null` | A made-up or guessed ID |

Other layout rules:

- One idea per Line. Each Line keeps the ID of the sentence in the Original it came from.
- Speak to the reader as "you". Name the sender ("The council", "Your doctor"), not "we" without a name.
- Keep dates, times, amounts, reference numbers, phone numbers and addresses exactly as they appear. See `safety.md`.
- A required action may be split over lines from the same source sentence ("You must pay £45." then "Pay it by 1 April 2026."). P1 still finds it. A year may be added to a date that has none, but never dropped.
- P3 counts "The letter says you must ..." as one idea. P4 allows "You are entitled to ...", "You are required to ...", "You are allowed to ...", "You are expected to ..." and "You are supposed to ...". Other passives, such as "You are asked to ...", still fail: write "The council asks you to ...".

## Tone (P10)

The P10 judge fails a line if either check below fails.

**Respectful, not childish.** The reader is an adult.

- Write as you would to any adult. No baby talk, no "Well done!", no exclamation marks to sound friendly.
- Don't talk down or over-explain things everyone knows.
- Don't use "simple", "easy", "just" or "don't worry".
- Say hard news plainly. Don't hide it or soften it until it changes meaning.

**No advice.** Say what the letter says. Never say what the reader should decide or do beyond what the letter asks.

| Allowed: what the letter says | Not allowed: advice |
| --- | --- |
| The letter says you must pay £45 by 1 April 2026. | You should pay this quickly. |
| The letter says you can ask the council to look again at this decision. | You should appeal this decision. |
| The letter gives a phone number for questions: 0300 123 4567. | It's a good idea to get help from a lawyer. |

If the letter itself gives an instruction, keep it as a required action (P1). Don't add any of your own.
