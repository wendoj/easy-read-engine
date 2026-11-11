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
- Write UI text in plain language too. Follow `easy-read-rules.md` where it fits.

## Layout

- Result screen: Original on the left, Easy Read on the right, picture to the left of each line.
- Use one colour per key fact, the same in both columns.
- Large, readable text. Print layout uses at least 16pt.
- Show the ARASAAC attribution in the result screen footer and the PDF footer.
