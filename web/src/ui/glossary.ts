/**
 * "Tap a word": a fixed list written by hand, so tapping a word sends no
 * letter text anywhere. Each meaning follows the Easy Read rules (one
 * sentence, at most 15 words, no advice) and each picture is from the symbol
 * index; `tests/glossary.test.ts` checks that.
 */

export interface GlossaryEntry {
  term: string;
  /** Lower case. Plurals are listed by hand. */
  forms: readonly string[];
  meaning: string;
  /** ARASAAC ID. */
  symbolId: string | null;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: "instalment",
    forms: ["instalment", "instalments", "installment", "installments"],
    meaning: "One part of a bigger payment. You pay a bit at a time.",
    symbolId: "4630",
  },
  {
    term: "summons",
    forms: ["summons", "summonses"],
    meaning: "A letter that tells you to go to a court.",
    symbolId: "8147",
  },
  {
    term: "arrears",
    forms: ["arrears"],
    meaning: "Money you should have paid already.",
    symbolId: "4630",
  },
  {
    term: "overdue",
    forms: ["overdue"],
    meaning: "Late. It should have been paid or done already.",
    symbolId: "37780",
  },
  {
    term: "outstanding",
    forms: ["outstanding"],
    meaning: "Still to be paid.",
    symbolId: "4630",
  },
  {
    term: "debt",
    forms: ["debt", "debts"],
    meaning: "Money that you owe to someone.",
    symbolId: "4630",
  },
  {
    term: "creditor",
    forms: ["creditor", "creditors"],
    meaning: "A person or a company that you owe money to.",
    symbolId: "4630",
  },
  {
    term: "liability order",
    forms: ["liability order", "liability orders"],
    meaning: "A court decision that says you owe the council money.",
    symbolId: "2957",
  },
  {
    term: "liable",
    forms: ["liable"],
    meaning: "The one who has to pay.",
    symbolId: "11473",
  },
  {
    term: "bailiff",
    forms: ["bailiff", "bailiffs"],
    meaning: "A person who is sent to collect money that you owe.",
    symbolId: "8147",
  },
  {
    term: "enforcement",
    forms: ["enforcement"],
    meaning: "Action to make sure a rule is followed or a debt is paid.",
    symbolId: "11473",
  },
  {
    term: "penalty",
    forms: ["penalty", "penalties"],
    meaning: "Money you must pay because a rule was broken.",
    symbolId: "10172",
  },
  {
    term: "surcharge",
    forms: ["surcharge", "surcharges"],
    meaning: "An extra charge added to what you pay.",
    symbolId: "4630",
  },
  {
    term: "appeal",
    forms: ["appeal", "appeals", "appealed", "appealing"],
    meaning: "Ask for a decision to be looked at again.",
    symbolId: "19553",
  },
  {
    term: "tribunal",
    forms: ["tribunal", "tribunals"],
    meaning: "A type of court. It decides when people disagree.",
    symbolId: "2957",
  },
  {
    term: "hearing",
    forms: ["hearing", "hearings"],
    meaning: "A meeting where a court or a tribunal listens to what people say.",
    symbolId: "8207",
  },
  {
    term: "warrant",
    forms: ["warrant", "warrants"],
    meaning: "A paper from a court that gives someone the power to act.",
    symbolId: "8147",
  },
  {
    term: "tenancy",
    forms: ["tenancy", "tenancies"],
    meaning: "An agreement that lets you live in a home you rent.",
    symbolId: "8012",
  },
  {
    term: "deposit",
    forms: ["deposit", "deposits"],
    meaning: "Money you pay first, as part payment or as a promise.",
    symbolId: "4630",
  },
  {
    term: "eligible",
    forms: ["eligible"],
    meaning: "Allowed to get something, because you meet the rules.",
    symbolId: "11473",
  },
  {
    term: "entitled",
    forms: ["entitled", "entitlement"],
    meaning: "Having the right to get something.",
    symbolId: "11473",
  },
  {
    term: "assessment",
    forms: ["assessment", "assessments"],
    meaning: "A check to find out what a person needs or owes.",
    symbolId: "39555",
  },
  {
    term: "statutory",
    forms: ["statutory"],
    meaning: "Set by the law.",
    symbolId: "11473",
  },
  {
    term: "direct debit",
    forms: ["direct debit", "direct debits"],
    meaning: "You let a company take money from your bank on set dates.",
    symbolId: "3062",
  },
];

export interface GlossaryMatch {
  start: number;
  end: number;
  entry: GlossaryEntry;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest forms first, so "liability order" wins over a shorter form.
const FORMS: { form: string; entry: GlossaryEntry }[] = GLOSSARY.flatMap((entry) =>
  entry.forms.map((form) => ({ form, entry })),
).sort((a, b) => b.form.length - a.form.length);

const BY_FORM = new Map(FORMS.map(({ form, entry }) => [form, entry]));

// A word is whole when no letter, digit, apostrophe or hyphen sits next to it.
const GLOSSARY_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}'’-])(?:${FORMS.map(({ form }) => escapeRegExp(form).replace(/ /g, "\\s+")).join("|")})(?![\\p{L}\\p{N}'’-])`,
  "giu",
);

/** In order, with no overlaps. Ignores case; any run of spaces in a phrase counts as one. */
export function findGlossaryMatches(text: string): GlossaryMatch[] {
  const out: GlossaryMatch[] = [];
  for (const m of text.matchAll(GLOSSARY_PATTERN)) {
    const entry = BY_FORM.get(m[0].toLowerCase().replace(/\s+/g, " "));
    if (entry) out.push({ start: m.index, end: m.index + m[0].length, entry });
  }
  return out;
}

export type WordPart = { text: string; entry: GlossaryEntry | null };

/** The parts cover the text exactly, with no gaps and no empty parts. */
export function splitAtGlossary(text: string, matches: readonly GlossaryMatch[]): WordPart[] {
  const parts: WordPart[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor || m.end > text.length) continue;
    if (m.start > cursor) parts.push({ text: text.slice(cursor, m.start), entry: null });
    parts.push({ text: text.slice(m.start, m.end), entry: m.entry });
    cursor = m.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), entry: null });
  return parts;
}
