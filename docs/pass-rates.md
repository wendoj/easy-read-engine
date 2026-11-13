# Pass rates

Latest full run: 13 November 2026, 21:36 UTC, 8 letters (3 public, 5 invented), Bedrock, 3 tries each. Raw results: `fixtures/results/20261113T213603Z-all.json`. No letter text or key-fact values appear here.

No letter passed all 10 rules. All 8 ended flagged and none was blocked: P1 passed on every letter. Eight letters give no pass rate for the planned 20.

The run includes the extractor and judge fixes below. It started before the P3 split (`0f5bff9`) was committed, so it does not include that change.

## Results

Rules passed, out of 8 letters: P1 8, P2 4, P3 1, P4 5, P5 1, P6 6, P7 4, P8 8, P9 2, P10 7. With a model that answers differently each time, a change of one letter could be noise.

| Letter | Status | Failing rules (lines) |
| --- | --- | --- |
| East Cambridgeshire council tax notice | flagged | P2 2, P3 3, P4 3, P5 6, P7 4, P9 15 |
| Manchester missed payment | flagged | P2 7, P3 8, P5 4, P9 22, P10 2 |
| Planning appeal | flagged | P2 1, P3 2, P4 9, P5 2, P7 1, P9 4 |
| Invented care assessment | flagged | P3 1, P5 3, P9 7 |
| Invented council tax reminder | flagged | P5 1 |
| Invented housing benefit change | flagged | P3 1, P6 1, P7 2, P9 2 |
| Invented parking penalty | flagged | P3 1, P5 1, P9 3 |
| Invented repair appointment | flagged | P2 1, P3 3, P4 2, P5 6, P6 1, P7 1 |

The run before it (10:31 UTC, `fixtures/results/20261113T103145Z-all.json`) ended with 6 flagged and 2 blocked on P1: Manchester and the invented council tax reminder. In that run P9 passed on 3 of 8 letters, and on 0 of 8 the day before.

## Fixes behind the change

Both blocks in the earlier run came from the key-fact extractor, which read things as required actions that the letter does not require. P1 still compares every date, amount, reference, phone number, address and action.

- A weekday range has one value, whether the letter writes "Monday—Friday" or "Monday to Friday" (`a3876d2`).
- Bullets under "We could:", "You can ...:" or "It's easy to ...:" are options, not actions. Bullets under "You must ...:" still count (`a3876d2`, `83092cd`).
- "So you don't have to pay" is not a duty (`a3876d2`).
- A heading such as "Council Tax reminder notice" is not an action, even when the language model tags the last word as a verb (`83092cd`).
- The P9 judge no longer fails a line for repeating another line. It accepts correct definitions and header labels, and it sees the postcode line that the sentence splitter cuts from an address (`9ad9ef1`).
- Lines that end in an "if" clause, or join two clauses with ", and", are split in code before P3 runs. This fixes 7 of the 20 P3 failures in the recorded samples (`0f5bff9`).

Each fix has a regression test.

## Single runs

The invented council tax reminder passed all 10 rules in one single-letter run on 13 November, after the extractor fixes. The full run above ended flagged on P5 for that letter. One passing run is not a pass rate.

The P3 split has had no live run.

## Not done

- Testing with Easy Read readers.
- 17 of the 20 planned public letters.
- A check that every sentence in the original gets a line.
- Faster long letters. Manchester takes about 6 minutes.
