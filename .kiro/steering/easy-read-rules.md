---
inclusion: always
---

# Easy Read rules

Follow these rules in every Easy Read line, every prompt in `prompts/`, and every example or fixture you write. Each rule matches a check in the Rule set (`.kiro/specs/easy-read/requirements.md`, "Correctness Properties"). P1 (key facts) is in `safety.md`.

## Guidance source

> **TODO (open question):** name the official Easy Read guidance these rules follow, with a link, and cite it in the README. Until then, these rules come from the spec's Rule set only. The thresholds below are starting values to tune, not published limits.

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
