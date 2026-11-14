---
name: Easy Read Engine
description: A checked Easy Read version of an official letter, read beside the original.
colors:
  ink-blue: "#1446a0"
  ink-blue-deep: "#0f3780"
  ink-blue-wash: "#e3ebfa"
  paper: "#fbfaf7"
  paper-wash: "#f4f2ed"
  sheet-white: "#ffffff"
  linen: "#f1efea"
  linen-deep: "#e4e1da"
  table-grey: "#efede8"
  print-black: "#1a1a1a"
  pencil-grey: "#4a4740"
  edge-grey: "#8c877e"
  field-edge: "#6b665e"
  stop-red: "#b3261e"
  stop-red-wash: "#fef2f2"
  pass-green: "#1b6b3a"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.2
  headline:
    fontFamily: "Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
  easy-read-line:
    fontFamily: "Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.5
  lead:
    fontFamily: "Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Atkinson Hyperlegible Next, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  sm: "7.2px"
  lg: "12px"
  field: "14px"
  xl: "16.8px"
  2xl: "21.6px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink-blue}"
    textColor: "{colors.sheet-white}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 24px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.ink-blue-deep}"
    textColor: "{colors.sheet-white}"
  button-outline:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.print-black}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 24px"
    height: "48px"
  button-outline-hover:
    backgroundColor: "{colors.paper-wash}"
  button-destructive:
    backgroundColor: "{colors.stop-red-wash}"
    textColor: "{colors.stop-red}"
    rounded: "{rounded.full}"
    height: "48px"
  tab-list:
    backgroundColor: "{colors.linen}"
    rounded: "{rounded.full}"
    padding: "4px"
    height: "56px"
  tab-active:
    backgroundColor: "{colors.ink-blue}"
    textColor: "{colors.sheet-white}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
  textarea:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.print-black}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "12px 16px"
  panel:
    backgroundColor: "{colors.sheet-white}"
    rounded: "{rounded.2xl}"
  alert-note:
    backgroundColor: "{colors.ink-blue-wash}"
    textColor: "{colors.print-black}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  alert-destructive:
    backgroundColor: "{colors.stop-red-wash}"
    textColor: "{colors.stop-red}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  easy-read-row:
    backgroundColor: "{colors.sheet-white}"
    typography: "{typography.easy-read-line}"
    padding: "24px"
  step-current:
    backgroundColor: "{colors.ink-blue}"
    textColor: "{colors.sheet-white}"
    rounded: "{rounded.full}"
    size: "36px"
---

# Design System: Easy Read Engine

## Overview

**Creative North Star: "The Kitchen-Table Letter"**

Two people sit at a table with a letter between them: the person it was sent to, and someone who helps them read it. The interface is the table and the paper. It is warm off-white, with white sheets laid on it, dark print, and one blue pen for the things you can press. Nothing on screen competes with the letter. Nothing moves unless something new has to be said.

The system is calm and patient. Space is generous, corners are soft, type is large, and every edge is a real line, not a shadow. Urgency is saved for one case: a fact that did not match the letter. Then, and only then, red appears. Density is low on purpose. Each Easy Read line gets its own row, its own picture and its own buttons, so the reader never has to search.

The current values come from the Easy Read guides (Inclusion Europe, Department of Health) and WCAG 2.2 AA. PRODUCT.md treats them as reference, not as binding brand. A redesign may replace them, but it must still meet the accessibility needs that PRODUCT.md lists.

**Key Characteristics:**
- Warm paper background, white sheets, near-black print.
- One accent colour, Ink Blue, for action, focus and selection.
- Flat: depth comes from borders and tone, never from shadow.
- Large type everywhere. Body text is 18px, and Easy Read lines are 24px.
- Pill-shaped controls at least 48px tall, each icon paired with a word.
- No animation apart from a 150ms fade for a status that appears later.

## Colors

A warm, low-chroma paper palette with one ink colour, plus red and green kept only for check results.

### Primary
- **Ink Blue** (`ink-blue`): primary buttons, the active tab, the current step, the focus ring, links, selected lines and the explained-word underline. It is the only colour that says "you can act here".
- **Ink Blue Deep** (`ink-blue-deep`): hover state of the primary button only.
- **Ink Blue Wash** (`ink-blue-wash`): fill behind the outside-AI notice, the simplified-version notice and a selected Easy Read line.

### Neutral
- **Paper** (`paper`): the page background. Warm, not white, so the white sheets read as objects on a table.
- **Paper Wash** (`paper-wash`): hover fill for outline buttons, the row being edited, and the empty picture slot.
- **Sheet White** (`sheet-white`): panels, cards, fields and the header bar.
- **Linen** (`linen`) and **Linen Deep** (`linen-deep`): tint surfaces. Linen sits behind the tab list. Linen Deep marks a finished step.
- **Table Grey** (`table-grey`): the secondary button and the passed-rule badge.
- **Print Black** (`print-black`): all body text.
- **Pencil Grey** (`pencil-grey`): secondary text, such as word counts, inactive step labels and notes. 8.9:1 on Paper.
- **Edge Grey** (`edge-grey`): every border and divider. 3.4:1, so panel edges stay visible.
- **Field Edge** (`field-edge`): outline-button and form-field borders, darker than panel edges at 5.4:1.

### Status
- **Stop Red** (`stop-red`) on **Stop Red Wash** (`stop-red-wash`): errors, the blocked state, failed rules, and the key-fact strip when P1 fails.
- **Pass Green** (`pass-green`): the tick and text "All N key facts match the letter". 6.5:1 on white, so it works as text.

### Key-fact highlights
Each fact type has one colour, the same in both columns, as a Tailwind 100 fill with 950 text: yellow for dates, orange for times, emerald for amounts, stone for reference numbers, purple for phone numbers, teal for addresses and fuchsia for things to do. The underline is the second signal: solid for a date, double for a time or address, dashed for money, dotted for a reference, wavy for a phone number. Actions carry the fill only, because they are often whole phrases and an underline would clash with the explained-word underline. A colour key for the types in the letter sits above the columns. Red and blue are never used here.

### Named Rules
**The One Pen Rule.** Ink Blue is the only accent. If something is blue, you can press it, it has focus, or it is selected. Nothing is blue for decoration.

**The Red Means Stop Rule.** Red appears only when a check failed or something went wrong. A flagged line that still reached the reader gets a quiet "Check this line" box in Linen, not red.

**The Two Cues Rule.** Colour is never the only signal. Every key fact also has an underline style, and every state also has an icon or a word.

## Typography

**Body Font:** Atkinson Hyperlegible Next (with ui-sans-serif, system-ui, sans-serif)
**Print Font:** Arial at 18pt in the exported PDF (from the Easy Read guides).

**Character:** One humanist sans-serif, drawn so that I, l and 1, and O and 0, look different. It is friendly without being childish, which suits adult readers.

### Hierarchy
- **Display** (600, 36px on phones, 40px from 640px, 1.2): the one page heading, "Make a letter easier to read".
- **Headline** (600, 28px, 1.25): section headings, such as Original, Easy Read and What you need to do.
- **Title** (600, 22px, 1.25): sub-headings and the brand name in the header.
- **Easy Read Line** (400, 24px, 1.5): each Easy Read line, and the field you edit a line in.
- **Lead** (400, 20px, 1.5): the one sentence under the page heading, and to-do counts.
- **Body** (400, 18px, 1.5): everything else, including alerts, table cells and the Original.
- **Label** (600, 18px): buttons, tabs, field labels.

### Named Rules
**The Two Weights Rule.** Only 400 and 600. Emphasis is 600, never italic: `em`, `i` and `cite` render upright and bold.

**The No Shouting Rule.** No capitals for whole words, no letter-spacing changes, no eyebrow labels over headings, no justified text. Everything is left-aligned.

**The 18px Floor.** No reading text is smaller than 18px. The only smaller text is the inert shadcn defaults that the app overrides.

## Layout

- **Container:** 1200px wide, centred, with a 16px side gutter. The input screen narrows to a centred 880px column, and the header narrows with it, so the mark always lines up with the content below.
- **Input screen:** page heading and one sentence, the step bar (Your letter, Check it, Easy Read), then one panel with a tab bar at the top and a send bar at the bottom. The outside-AI notice sits in the send bar, right above the button that sends the letter.
- **Result screen:** meaning first. The simplified-version notice, then "What you need to do" and "Dates and amounts" side by side from 1024px (both closed, with a one-line preview), the checks strip and the colour key, then two columns from 1024px. The Original is on the left, and the Easy Read version is on the right. The ratio is 5:7, because the Easy Read column is the one people read. The Original column is sticky. Download PDF and Print sit beside the Easy Read heading and again in a closing block after the last line.
- **Narrow screens:** under 1024px, the columns stack with the Original first. A "Go to the Easy Read version" button sits above them. The Original box scrolls on its own but hands the scroll back to the page at its ends. A selected line shows its source sentence under it ("From the letter").
- **Rhythm:** gaps of 12px inside groups, 24px between blocks, 32px between columns and major sections. Panel padding is 16px on phones and 24px from 640px.
- **Easy Read row:** picture (80px) on the left with a "Line N" button under it, then the line. Its buttons appear only when the line is selected, so an unselected row is just picture, number and sentence. Each row is separated from the next by a divider. A missing picture still takes up its slot, so every line starts in the same place. Long words and URLs wrap anywhere rather than overflow.

## Elevation & Depth

None. The system is flat. Depth comes from tone (white sheets on warm paper) and from real 1px borders in Edge Grey. Emphasis uses a 2px Ink Blue border, as on the simplified-version notice and the to-do box. Real borders also keep every edge visible in Windows high contrast mode.

### Named Rules
**The Paper on a Table Rule.** No box-shadows. If something needs to stand out, give it a border or a different surface tone.

## Shapes

Soft and round, never sharp. Panels, the Original box and the Easy Read list use a generous radius (`2xl`). Alerts and the selected-line frame use `xl`. Fields use `field`. Pictures use `lg`. Every button, tab and step marker is a full pill or circle. All corners come from one base radius of 12px scaled up or down, so new parts should use those steps, not new values.

## Components

### Buttons
Calm, large and labelled. Every button says what it does in words, and an icon only ever sits beside a word.
- **Shape:** full pill (`rounded.full`), 48px tall, 24px side padding, Label type.
- **Primary:** Ink Blue with white text, for the one main action on a screen, such as Next, Read the letter or Download PDF.
- **Outline:** white with a Field Edge border, for everything else (Listen, Show in the Original, Change this line, Print, New letter, sample letters).
- **Hover / Focus:** a 150ms colour change. Press scales to 0.96 where motion is allowed. Focus is the global 3px Ink Blue ring, 2px off the element.
- **Destructive:** red text on Stop Red Wash with a faint red border. Rarely used.

### Tabs
- **Style:** a pill track in Linen with an Edge Grey border, 56px tall. The active tab is a solid Ink Blue pill with white text. Each tab has an icon and a word ("Paste text", "Photo or PDF").

### Cards / Containers (Panel)
- **Corner Style:** `2xl`.
- **Background:** Sheet White on Paper.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px Edge Grey.
- **Internal Padding:** 16px, or 24px from 640px. Control bars at the top or bottom are split off by a border.

### Inputs / Fields
- **Style:** white, 1px Field Edge border, `field` radius, 18px text.
- **Inside a panel:** the letter field drops its own border and radius. The panel is its edge, and the text cursor shows focus, so it has no focus ring.
- **Error / Disabled:** red border for an error. Disabled fields drop to 50% opacity.

### Alerts (notices)
- **Note:** Ink Blue Wash fill, Field Edge border, an info icon and one sentence. The outside-AI notice and the simplified-version notice have no close button. The simplified-version notice has a 2px Ink Blue border and semibold text.
- **Destructive:** Stop Red Wash fill, red text and a circle-alert icon.

### Navigation
- **Header:** white bar, 72px, bottom border, with the mark and "Easy Read" on the left. On the result and print screens, a "New letter" outline button sits on the right. It is not sticky, and it is hidden when printing.
- **Steps:** three numbered circles (36px) with words. The current step is solid Ink Blue, a finished step shows a tick on Linen Deep, and the rest are white with a border. It never animates.

### Easy Read Line (signature)
The core of the product. Each row has an 80px ARASAAC picture on a white tile with a "Line N" pill button under it, then the line in 24px type (600 when it holds a date or an amount, not a bare year). Pressing "Line N" or the sentence selects the line: the row turns Ink Blue Wash, the "Line N" pill turns solid Ink Blue, the source sentence lights up in the Original (and shows as "From the letter" under the line on narrow screens), and Listen, Change this line and "Next line to check" appear. A line that failed a check has a "Check this line with the letter." box under the text: Linen fill, a flag icon, and a "Why?" link that shows the reasons in plain words for the supporter. Key facts carry their colour and underline. Explained words have a thick dotted Ink Blue underline and open a popover with a picture and the meaning. A selected line gets a 2px Ink Blue frame on Ink Blue Wash, and its sentence lights up in the Original. While a line is being edited, the row turns Paper Wash.

### Checks Strip (signature)
A white panel after the summary. It leads with the key-fact result: a green tick and "All N key facts match the letter", or a red icon and the failure. Then it says how many checks found lines to look at, and "See the check report" opens a side sheet with one entry per rule: its plain name, its code, a Passed or Failed badge, and each reason starting with a "Line N" link to the line. Sample recording details sit at the end of the sheet.

### What You Need to Do (signature)
A white panel with a 2px Ink Blue border that starts closed. Its header button shows the heading, the count and one preview line (the first payment or "must" item), with "Show" and a chevron. Open, each item has a checkbox, the line in 20px, and Listen, Add to calendar (when it has one full date) and "Go to line N". "Dates and amounts" sits beside it in a 1px-bordered panel built the same way: each distinct date, time limit and amount as written in the letter (bare years left out), with "Go to line N". Both open and close at once, with no animation.

## Do's and Don'ts

### Do:
- **Do** keep Ink Blue for things you can press, focus or select (The One Pen Rule).
- **Do** give every panel and control a real border, so edges survive forced-colours mode.
- **Do** keep every control at least 48px tall, with a word next to any icon.
- **Do** pair every key-fact colour with its underline style, and every state with an icon or a word.
- **Do** keep reading text at 18px or larger, and Easy Read lines at 24px with 1.5 line height.
- **Do** use the 150ms fade only for a status that appears after load, and nothing under `prefers-reduced-motion`.

### Don't:
- **Don't** use box-shadows, gradients or glassy effects (The Paper on a Table Rule).
- **Don't** animate entrances, stagger lists or use shimmer loaders.
- **Don't** use italics, all-caps words, letter-spacing changes, eyebrow labels or justified text.
- **Don't** add a mascot, character or cartoon. The readers are adults.
- **Don't** use red for anything other than a failed check or an error.
- **Don't** add a close button to the outside-AI notice or the simplified-version notice.
- **Don't** add a weight other than 400 and 600.
