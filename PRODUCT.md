# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences carry equal weight, and they often sit at one screen together:

- **The person who got the letter.** An adult with a learning disability, low literacy or English as a second language. They have an official letter (council tax, NHS, benefits, planning) and they need to know what it says.
- **The supporter.** A carer or support worker who reads the letter with them. They need to trust that the Easy Read version says what the letter says before they explain it.

A third audience is temporary: Kiroween 2026 judges, who evaluate the entry in the Frankenstein category. They open the sample letters and can use live conversion with an access key.

## Product Purpose

Easy Read Engine turns an official letter into Easy Read: short sentences, plain words and a picture for each line. The person gets the meaning of their own letter without retyping it, and the supporter can check every line against the original.

Success means that every line that reaches the reader has passed the published rules, and that every date, amount, reference number and required action appears unchanged.

## Positioning

The model writes, and deterministic code decides what reaches the reader. The checker extracts key facts from the original before the model writes anything, then runs 10 fixed rules (P1 to P10) on every line. A line that changes a key fact is blocked, not shown. Other AI Easy Read tools, such as Swindon's Simply Readable, serve council staff and describe no automated checks. This tool serves the person who got the letter and checks each line.

## Operating Context

- Flow: paste text or upload a PDF or photo, confirm the extracted text, convert, then read the result with the original next to the Easy Read version. Lines can be edited. The result exports as an A4 PDF.
- The result screen keeps the original beside the Easy Read version on purpose, so the reader or supporter can compare them. Key facts are highlighted in both columns.
- A checks strip and a check report show which rules passed or failed, by name, in plain words.
- Sample letters and PDF export are open to anyone and make no model call. Live conversion needs an access key, because it calls a paid model.
- Results are never stored. A reload of a sample keeps its ID in the URL. A reload of the user's own letter loses it.

## Capabilities and Constraints

- Input: pasted text, typed PDF, or a clear photo of a printed letter. Handwriting is rejected. The limit is 1,500 words.
- Rules: P1 key facts unchanged, P2 at most 15 words per sentence, P3 one idea per sentence, P4 no passive voice, P5 plain words, P6 digits for numbers, P7 abbreviations explained, P8 real pictogram IDs, P9 meaning kept (judge model), P10 respectful tone and no advice (judge model).
- Gating: failed lines regenerate up to 3 tries. If P1 never passes, the output is blocked and export is off. Any other rule that still fails is flagged, never hidden. If P10 could not run, export is off. If the checker is down, nothing is shown.
- Out of scope: user accounts, translation, handwriting, and any advice about what the letter means for the reader.
- Stack: Next.js web app (`web/`) with shadcn/ui and Tailwind; Python checker (`checker/`) with FastAPI and spaCy, also an MCP server. Models via Amazon Bedrock (`eu-west-2`) with Groq as the fallback.
- Terminology: "Original" (the confirmed letter text), "Easy Read version", "line", "key fact", "check", "rule", "check report". The original letter is always "the official one".

## Brand Commitments

- Name: Easy Read Engine.
- Voice: UI text follows the Easy Read rules where it fits. Short sentences, "you", no jargon, no "simple", "easy", "just" or "don't worry", no exclamation marks. Buttons say what they do in words.
- No mascot, character or cartoon. The readers are adults (IE 1.3).
- Pictograms come from ARASAAC (Sergio Palao, CC BY-NC-SA, Government of Aragón). The attribution appears in the result screen footer and the PDF footer. No commercial use without the owner's permission.
- The current visual choices in `.kiro/steering/ui.md` (typeface, colours, sizes, motion rules) are reference, not binding. A redesign may replace them, as long as it meets the accessibility needs below.

## Evidence on Hand

- Three public sample letters with recorded results in `web/data/samples/`: East Cambridgeshire council tax final notice, Manchester missed council tax payment, planning appeal notification.
- Fixture letters and pipeline results in `fixtures/`, and pass rates in `docs/pass-rates.md`.
- Live site: easyread.wendyji.com.
- Guidance sources: Inclusion Europe, *Information for all*, and the Department of Health, *Making written information easier to understand*.
- No user research, testimonials, partner organisations or usage numbers exist. Do not invent them.

## Product Principles

1. **The original is the official letter.** It stays on every result screen, and every output says the Easy Read version is a simplified copy.
2. **Checked or not shown.** No line reaches the reader without passing the checker. A failure is named, never hidden.
3. **Say what the letter says, never what to do.** No advice about paying, appealing, agreeing or getting help unless the letter says it.
4. **Respect the reader as an adult.** Plain, not childish.
5. **Letter text is private.** Nothing is stored or logged, and users are told the text goes to an outside AI provider.

## Accessibility & Inclusion

- Standard: WCAG 2.2 AA, plus the layout guidance in the Easy Read guides (Inclusion Europe, Department of Health).
- Readers may have learning disabilities, low literacy or limited English. Text must be large, left-aligned and high contrast, and colour must never be the only cue (key facts also use an underline style per type).
- The guides advise against animation on screen. Motion must stay minimal and respect `prefers-reduced-motion`.
- Controls must have large hit targets, visible focus, and real borders that survive forced-colours mode.
- The exported PDF follows the guides: Arial at 18pt, left-aligned, pictures to the left, dark text on a light background.
