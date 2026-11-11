# Easy Read rules

Copied from `.kiro/steering/easy-read-rules.md` and `.kiro/steering/safety.md` in the [Easy Read Engine](https://github.com/wendoj/easy-read-engine) repository. P1 to P8 are checked by the `easy-read-checker` MCP server. P9 and P10 need a model judge.

## P1. Key facts

Key facts are dates, times, money amounts, reference numbers, phone numbers, addresses and required actions.

- Extract key facts from the Original before writing. P1 compares the output with the Original, never with the output.
- Every key fact must appear in the output with an identical normalised value. Don't round, reformat into a different value, or "fix" a number.
- A required action may be split over lines from the same source sentence ("You must pay the balance of £45." then "Pay it by 1 April 2026."). A year may be added to a date that has none, but never dropped.
- If P1 fails, block the output and name the key fact that failed.

## P2 to P8

| Rule | Write it like this | Not like this |
| --- | --- | --- |
| **P2. Short sentences.** No more than 15 words in a sentence. | You need to pay £45. | Following our review of your account, you are now required to pay the outstanding balance of £45. |
| **P3. One idea per sentence.** One main verb clause. Split "and", "but", "because" and "if" clauses into separate lines. | The council got your form. The council will reply by 14 March 2026. | We have received your form and we will respond by 14 March 2026. |
| **P4. Active voice.** Say who does the action. No passive verbs. | The council will send you a letter. | A letter will be sent to you. |
| **P5. Plain words.** Use common, everyday words. If you must use a harder word, explain it the first time. | Your rent is the money you pay to live in your home. | Your rental liability has been reassessed. |
| **P6. Numbers as digits.** Write every number in digits. | You have 3 weeks. | You have three weeks. |
| **P7. Explain abbreviations.** Write the full words the first time, with the short form in brackets. Or don't use the short form. | Personal Independence Payment (PIP) | PIP |
| **P8. Real pictures only.** A picture must come from the symbol library index. If no picture fits, use no picture. | `symbol_id: null` | A made-up or guessed ID |

Notes on how the checker reads P3 and P4:

- P3 counts "The letter says you must ..." as one idea. The clause after a reporting verb is not counted when the subject is the letter, a named sender or "it".
- P4 allows "You are entitled to ...", "You are required to ...", "You are allowed to ...", "You are expected to ..." and "You are supposed to ...". Other passives, such as "You are asked to ...", still fail: write "The council asks you to ...".

## Layout of each line

- One idea per line. Each line keeps the ID of the sentence in the Original it came from.
- Speak to the reader as "you". Name the sender ("The council", "Your doctor"), not "we" without a name.
- Keep dates, times, amounts, reference numbers, phone numbers and addresses exactly as they appear.

## P9. Meaning

Each line keeps the meaning of its source sentence. Nothing is added that the letter doesn't say.

## P10. Tone and no advice

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

## Where the rules come from

The rules follow two published guides. The 15-word limit and the pass or fail form of each check are this project's choices.

- Inclusion Europe, [Information for all: European standards for making information easy to read and understand](https://www.inclusion-europe.eu/wp-content/uploads/2017/06/EN_Information_for_all.pdf) (2010).
- Department of Health, [Making written information easier to understand for people with learning disabilities: guidance for people who commission or produce Easy Read information, revised edition 2010](https://www.gov.uk/government/publications/making-written-information-easier-to-understand-for-people-with-learning-disabilities-guidance-for-people-who-commission-or-produce-easy-read-information-revised-edition-2010).

The README of the Easy Read Engine repository maps each rule to the point in each guide it comes from.
