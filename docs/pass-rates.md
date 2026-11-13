# Pass rates

Latest full run: 13 November 2026, 8 letters (3 public, 5 invented), Bedrock, 3 tries each. Raw results: `fixtures/results/20261113T103145Z-all.json`. No letter text or key-fact values appear here.

No letter passed all 10 rules in this run. 6 ended flagged and 2 blocked on P1. Eight letters give no pass rate for the planned 20.

## Results

Rules passed, out of 8 letters: P1 6, P2 4, P3 1, P4 5, P5 2, P6 7, P7 3, P8 8, P9 3, P10 6. The day before, P9 passed on 0 of 8. With a model that answers differently each time, a change of one letter could be noise.

| Letter | Status | Failing rules (lines) |
| --- | --- | --- |
| East Cambridgeshire council tax notice | flagged | P2 11, P3 14, P4 6, P5 13, P7 5, P9 10 |
| Manchester missed payment | blocked | P1 10, P2 1, P3 10, P5 5, P9 29, P10 2 |
| Planning appeal | flagged | P2 2, P3 6, P4 5, P5 3, P7 1, P9 17, P10 6 |
| Invented care assessment | flagged | P3 1, P5 2, P7 1, P9 2 |
| Invented council tax reminder | blocked | P1 1, P7 2 |
| Invented housing benefit change | flagged | P3 1, P7 1 |
| Invented parking penalty | flagged | P3 1, P5 2 |
| Invented repair appointment | flagged | P2 1, P3 2, P4 2, P5 4, P6 1, P9 5 |

## Fixes after the run

Both blocks came from the key-fact extractor, which read things as required actions that the letter does not require. P1 still compares every date, amount, reference, phone number, address and action.

- A weekday range has one value, whether the letter writes "Monday—Friday" or "Monday to Friday" (`a3876d2`).
- Bullets under "We could:", "You can ...:" or "It's easy to ...:" are options, not actions. Bullets under "You must ...:" still count (`a3876d2`, `83092cd`).
- "So you don't have to pay" is not a duty (`a3876d2`).
- A heading such as "Council Tax reminder notice" is not an action, even when the language model tags the last word as a verb (`83092cd`).
- The P9 judge no longer fails a line for repeating another line. It accepts correct definitions and header labels, and it sees the postcode line that the sentence splitter cuts from an address (`9ad9ef1`).
- Lines that end in an "if" clause, or join two clauses with ", and", are split in code before P3 runs. This fixes 7 of the 20 P3 failures in the recorded samples (`0f5bff9`).

Each fix has a regression test.

## Single runs after the fixes

These are one run per letter, not a pass rate:

- The invented council tax reminder passed all 10 rules on try 2.
- Manchester ended flagged. P1 passed on all 3 tries. P2 (4 lines), P3 (25), P9 (24) and P10 (1) failed on the last try. It was blocked in the full run, so it can still miss P1.

The fixture run was not repeated after the fixes. The P3 split has had no live run.

## Not done

- Testing with Easy Read readers.
- 17 of the 20 planned public letters.
- A check that every sentence in the original gets a line.
- Faster long letters. Manchester takes about 6 minutes.
