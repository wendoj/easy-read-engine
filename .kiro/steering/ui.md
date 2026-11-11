---
inclusion: fileMatch
fileMatchPattern: ["web/app/**/*.tsx", "web/components/**/*.tsx"]
---

# UI

## Components

- Use shadcn/ui components from `web/components/ui/`. Add missing ones with `npx shadcn@latest add <name>` from `web/`. Don't hand-build a component shadcn already has.
- Style with Tailwind classes and the theme variables in `web/app/globals.css`.

| Element | Component |
| --- | --- |
| Paste or upload | `Tabs`, `Textarea`, `Input` (file), `Button` |
| Safety and privacy notices | `Alert`, with no close button |
| Progress | `Progress` and one status line |
| Pass count and flag markers | `Badge` |
| Rule report | `Sheet` with a `Table` |
| Line editing | `Textarea` and `Button`, inline in the line |
| Sample letters | `Select` |
| Errors (limit, handwriting, 503) | `Alert` with `variant="destructive"` |

## Copy

- No eyebrow headlines: no small uppercase label above a heading.
- Keep copy short. Use a heading and the controls.
- No helper text that repeats what a label or button already says.
- The two required notices are one sentence each: the simplified-version notice (R7.1) and the outside-AI notice (R7.5).
- Write UI text in plain language too. Follow `easy-read-rules.md` where it fits: short sentences, "you", no jargon, no "simple", "easy", "just" or "don't worry", no exclamation marks.
- Buttons say what they do in words ("Make it Easy Read", "Change this line", "Start again"). Icons always sit next to a text label.
- No mascot, character or cartoon. The readers are adults (IE 1.3).

## Layout

- Input screen: heading, one sentence, the step bar (`components/steps.tsx`: Your letter, Check it, Easy Read), then one panel with Paste text and Photo or PDF tabs. The R7.5 notice is an `Alert` with no close button, right above the button that sends the letter out, on both steps.
- Progress: one status line in words ("Checking again (try 2 of 3)"), the `Progress` bar and the stage list. No shimmer.
- Result screen: Original on the left, Easy Read on the right, picture to the left of each line. The Easy Read column is wider (5:7), because it is the one people read.
- Narrow screens (under 1024px): the columns stack, Original first, with a "Go to the Easy Read version" link above them. Easy Read guidance says "Do not write in columns" (IE 2.27), but safety.md requires the Original on every result screen so the reader or a supporter can check it, so it stays, with the Easy Read version easy to reach.
- Use one colour per key fact, the same in both columns, plus an underline style per fact type, so colour is never the only cue.
- A flagged line shows the failed rule in words with a flag icon. The blocked state keeps the Original and lists the key facts that did not match.
- Reload: results are never stored (R7.4). A sample letter keeps its ID in the URL (`/result?sample=<id>`) and loads again. The user's own letter shows "Your Easy Read version is gone" and "Start again", and the browser asks before a reload while it is on screen.
- Print layout uses at least 16pt (18pt text, 20pt lines), a picture left of each line, the R7.1 notice at the top and the ARASAAC attribution in the footer.
- Show the ARASAAC attribution in the result screen footer and the PDF footer.

## Accessibility

These follow the Easy Read guides cited in `easy-read-rules.md` and the README ("Easy Read guidance"), and WCAG 2.2 AA.

| Thing | Value |
| --- | --- |
| Typeface | Atkinson Hyperlegible Next (`web/app/fonts.ts`), sans-serif, drawn so similar letters look different. Weights 400 and 600 only |
| Body text | At least 18px, line height 1.5 |
| Easy Read lines | 24px, line height 1.5, each line in its own row with 24px padding |
| Pictures | 80px on screen, 30mm in print, left of the text |
| Text style | Left-aligned, never justified. No italics, no capitals for whole words, no letter-spacing changes |
| Colours | Dark text `#1a1a1a` on off-white `#fbfaf7` or white. One accent, blue `#1446a0`, for buttons, focus and selection |
| Contrast | Text at least 7:1 where possible, never under 4.5:1. Borders and form fields at least 3:1 |
| Hit targets | Buttons, tabs and fields at least 48px tall |
| Focus | A 3px ring in the accent blue, 2px off the element, on every control |
| Motion | No entrances, cascades or shimmer ("Do not have animations on the screen", IE section 3, standard 21). Only a 150ms fade for a status that appears later. Nothing moves under `prefers-reduced-motion` |
| Forced colours | Every panel and control has a real border, so edges stay visible in Windows high contrast mode |
