> **DRAFT.** For you to edit before posting. Every fact here comes from this repository.

## Short version

Easy Read Engine turns council and NHS letters into Easy Read: short sentences, plain words, a picture per idea.

A model writes the lines. A rule checker with no model decides if you see them. If a date or amount changes, the output is blocked.

Built with Kiro for #KiroweenHackathon26

[Add the live URL here]

## Longer version

Many people can't read the letters councils and the NHS send. Easy Read versions are made by hand, so most letters never get one.

Easy Read Engine makes one, and checks it against 10 rules before you see it. The rules follow Inclusion Europe's Easy Read standards and the UK Department of Health's 2010 guidance.

- Every date, amount and reference number must match the original letter, or the output is blocked
- The original stays on screen next to the Easy Read version
- It says what the letter says, and never gives advice

Frankenstein parts: a language model, spaCy, ARASAAC pictograms, property tests and headless Chromium. Built spec-first with Kiro, with the checker packaged as a Kiro Power.

[Add a quote from an Easy Read reviewer here]

#KiroweenHackathon26

[Add the live URL and the repository link here]
