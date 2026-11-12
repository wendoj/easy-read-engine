# Result page: collapsible to-do box and failures moved to the report

Status: agreed in interview, 12 November 2026. Not built yet.

## Problem

1. On `/result`, "What you need to do" is a full-height checklist above the
   Original and Easy Read columns. With 4 or more actions, the reader has to
   scroll past it to reach the Easy Read lines.
2. Long letters still flag P2–P9 on many lines after 3 tries, most often P5
   (plain words) and P9 (keeps the meaning). Each flagged line and to-do item
   shows a red badge such as "Failed: Plain words, Keeps the meaning of the
   letter". The lines still read well, and the red badges make a usable
   result look broken to the reader.

## Who sees what

- **Reader** (person with a learning disability, low literacy or ESL): sees
  clean lines with no per-line failure badges.
- **Carer or support worker**: opens the check report from the red
  "N of 10 checks passed" button. The report says which rules failed and on
  which lines, and takes them to each line.

## Decisions

### 1. "What you need to do" collapses

- It **starts closed** on every visit. The open or closed state is not stored
  anywhere: no localStorage and no URL.
- It stays **in the same place**, full width above the two columns.
- The closed row shows the heading "What you need to do" and a count:
  "1 thing to do" or "N things to do". It shows nothing else (no deadline
  preview). A chevron on the right turns 180° when open.
- The whole closed row is the toggle. It is at least 48px tall and has a
  visible focus ring. It uses `aria-expanded` and `aria-controls`, or a
  native `<details>`/`<summary>`. Use Radix Collapsible if the native
  element can't animate cleanly.
- The open content is the current checklist: checkbox, line text with key
  facts, "Listen" and "Add to calendar". The per-item failure badge is
  removed (see 2).
- Ticks still live only in component state. Closing and reopening the box
  keeps them, because the content stays mounted.
- The box keeps its current look: `border-2 border-primary`, `rounded-2xl`,
  `bg-card`.

**Motion** (`/jmo-workflow:animate`; occasional use, purpose: spatial
consistency):

- Open and close animate height and opacity over 200ms with
  `cubic-bezier(0.23, 1, 0.32, 1)`. Height is allowed here because this is
  an accordion.
- The chevron rotates with a 200ms transform transition.
- Under `prefers-reduced-motion: reduce`, the box opens with no height
  animation and only a 150ms opacity fade. The chevron changes instantly.
- Use a transition, not keyframes, so a quick double tap reverses cleanly.

### 2. Per-line failure badges are removed from the screen

- Remove the red `FlagIcon` + "Failed: …" badge from:
  - each Easy Read line (`LineRow` in `app/result/result-view.tsx`)
  - each to-do item (`app/result/to-do-box.tsx`)
- The **red "N of 10 checks passed" button stays exactly as it is**. It is
  red when any rule fails and opens the Check report. This is where the
  failure stays visible (R3.4).
- No other change to the report's content or wording. It stays aimed at
  carers and support workers and keeps the rule names.
- Unchanged:
  - **Blocked results (P1):** they show no lines and the failed key facts,
    as now.
  - **Judge unavailable:** the "not judged" export alert stays.
  - **Selected line:** the line selection ring stays.
  - **Edits:** after an edit, new failures still appear in the report and
    in the button count.

### 3. Report line numbers take the carer to the line

- In the Check report's "Lines" column, each number becomes a link-style
  button.
- Clicking or pressing Enter does 4 things:
  1. closes the sheet
  2. scrolls the Easy Read line into view (`block: "center"`, smooth unless
     reduced motion)
  3. moves focus to that line
  4. selects it, the same as "Show in the Original", so its sentence is
     highlighted in the Original
- Each button's accessible name is "Go to line N".
- Lines are numbered from 1 in on-screen order, as `ruleRows` already does.
- If the line no longer exists after an edit, the number is plain text. This
  should not happen, because the report is rebuilt from the current result.

### 4. Print and PDF: one summary at the end

- Remove the per-row `.er-marker` ("Failed: …") from the print layout:
  `src/export/print-document.ts`, `app/print/print-view.tsx` and the PDF
  HTML. Both renderers share `PrintDocument`.
- Move the pass count and the failed checks from under the notice to a
  **"Checks" section at the end** of the document, before the footer
  attribution.
- For each failed check, the section gives the check name and the flagged
  lines. Printed rows have no numbers, so each line is listed by its first
  words (up to 8 words, then "…"). A carer can then find the line on paper.
  - Example: "Plain words: 'Your arrears are £181.62.'; 'A summons is…'"
- When every check passed, the section says "10 of 10 checks passed" and
  nothing else.
- The section keeps the 16pt minimum and the print palette. It must not
  split mid-item across pages (`break-inside: avoid` per item).

## Requirements to amend

- **R3.4** ("SHALL show the output with that rule flagged, and SHALL NOT
  hide the failure"). Reword so the flag lives in the pass count and the
  check report on screen, and in the end-of-document Checks section in
  print. It is no longer on each line. The failure is still never hidden.
- **`.kiro/specs/easy-read/design.md`** and the header comments in
  `result-view.tsx` (task 24 note: "flagged lines name their failed rules")
  and `print-document.ts` ("each affected line has a marker"): update them
  to match.
- **`.kiro/steering/ui.md`**: note that per-line failure badges are not
  shown to the reader, if it says otherwise.

## Code touch list

| File | Change |
| --- | --- |
| `app/result/to-do-box.tsx` | Collapsible wrapper, count line, chevron, motion; remove badge |
| `app/result/result-view.tsx` | Remove line badge; pass a "go to line" handler to `RuleReport`; focus/scroll/select logic |
| `app/result/rule-report.tsx` | Line numbers become buttons that close the sheet and call the handler |
| `src/ui/rule-report.ts` | `lineMarkerLabel` / `lineMarkers` may become unused on screen; keep them if print still needs them, otherwise delete them along with their tests |
| `src/ui/to-do-list.ts` | Count label helper ("1 thing to do" / "N things to do") |
| `src/export/print-document.ts` | Drop `marker` from `PrintRow`; add an end `checks` section with the start of each flagged line; move CSS |
| `app/print/print-view.tsx`, PDF HTML renderer | Render the end section; no per-row marker |
| `tests/rule-report.test.ts`, print tests, to-do tests | Update for the removed markers; add tests for the count label, the end-of-document summary (line excerpts, 8-word cut-off), and the go-to-line handler |

## Acceptance checks

1. On a sample with 4 or more actions, the page loads with the to-do box
   closed, showing "N things to do". The Easy Read heading is visible
   without scrolling on a 1440×900 desktop.
2. Keyboard: Tab to the to-do row, press Enter to open, Enter again to
   close. Screen readers announce expanded and collapsed. Ticks survive
   closing and reopening.
3. No "Failed:" text appears anywhere on `/result` outside the Check report.
4. The red pass-count button still shows "N of 10 checks passed" when a
   rule fails.
5. In the report, clicking a line number closes the sheet, scrolls to the
   line, focuses it and highlights its sentence in the Original.
6. In print preview and the PDF, rows have no markers, and the Checks
   section at the end lists each failed check with excerpts of its lines.
7. With reduced motion on, the box opens with a fade only.
8. Blocked (P1) results look exactly as before.
9. `npx vitest run`, `npx tsc --noEmit` and `npx eslint` pass.

## Out of scope

- Changing which rules fail, or the pipeline. Fewer failures is separate
  work: the `plain-words.ts` swaps, the If-split and the judge's
  reason-first reply.
- Softening or rewording the report for readers.
- Remembering the to-do box state.
