/**
 * Hard words that official letters use, each with a plain swap.
 *
 * P5 fails a line for "N words that are not common", but its reasons never
 * name the words (checker details hold no text, R7.4), so the model had to
 * guess which word to change. The recorded samples kept "summons",
 * "appellant", "authority" and "hardship" through 3 tries. The rewrite and
 * regenerate prompts now get the entries for the words in the text they see.
 *
 * Every word here fails P5 (it is not on the checker's common-word list), and
 * every swap passes P5. Check both with the checker before adding an entry.
 * A swap is a suggestion: the prompts tell the model to keep the meaning.
 */
export interface PlainWord {
  /** The forms to look for, lower case. The first is shown to the model. */
  forms: readonly string[];
  /** A plain word or phrase to use instead, or an explanation of the word. */
  plain: string;
}

export const PLAIN_WORDS: readonly PlainWord[] = [
  { forms: ["administrative"], plain: "office" },
  { forms: ["amend", "amends", "amended", "amending", "amendment", "amendments"], plain: "change, changed" },
  { forms: ["appellant", "appellants"], plain: "the person who appealed" },
  { forms: ["arrears"], plain: "money you owe" },
  { forms: ["auditor", "auditors"], plain: "people who check the council's accounts" },
  { forms: ["authority", "authorities"], plain: "the council, or the group in charge (say which)" },
  { forms: ["automated", "automatically"], plain: "a computer does it (say what the computer does)" },
  { forms: ["bailiff", "bailiffs"], plain: "a person sent to collect money you owe" },
  { forms: ["commence", "commences", "commenced"], plain: "start" },
  { forms: ["correspondence"], plain: "letters" },
  { forms: ["deduct", "deducts", "deducted", "deduction", "deductions"], plain: "take off, the money taken off" },
  { forms: ["discretionary"], plain: "extra" },
  { forms: ["dispose", "disposed", "disposal"], plain: "get rid of" },
  { forms: ["dwelling", "dwellings", "residence"], plain: "home" },
  { forms: ["electoral", "electorate"], plain: "voting, the voter list" },
  { forms: ["electronically"], plain: "by email or online" },
  { forms: ["eligible"], plain: "able to get" },
  { forms: ["enforcement"], plain: "action to make you pay" },
  { forms: ["exempt", "exemption", "exemptions"], plain: "do not have to pay" },
  { forms: ["finalise", "finalised", "finalize", "finalized"], plain: "finish" },
  { forms: ["fraud", "fraudulent"], plain: "lying to get money" },
  { forms: ["guidance"], plain: "information" },
  { forms: ["hardship"], plain: "money problems" },
  { forms: ["insert", "inserted"], plain: "put in" },
  { forms: ["inspect", "inspected", "inspection"], plain: "look at" },
  { forms: ["instalment", "instalments", "installment", "installments"], plain: "smaller payments" },
  { forms: ["liable"], plain: "have to pay" },
  { forms: ["notify", "notified", "notification"], plain: "tell" },
  { forms: ["obtain", "obtained"], plain: "get" },
  { forms: ["occupier", "occupiers", "tenant", "tenants"], plain: "the person who lives there" },
  { forms: ["outstanding"], plain: "still to pay" },
  { forms: ["procedural", "procedurally"], plain: "about the steps" },
  { forms: ["publish", "published"], plain: "put online for everyone to see" },
  { forms: ["remittance", "remittances"], plain: "payment" },
  { forms: ["reside", "resides", "resided"], plain: "live" },
  { forms: ["statistician", "statisticians"], plain: "people who study numbers" },
  { forms: ["summons", "summonses"], plain: "a letter that tells you to go to court" },
  { forms: ["terminate", "terminated"], plain: "end" },
  { forms: ["venue"], plain: "place" },
  { forms: ["vulnerable"], plain: "people who need extra help" },
];

const BY_FORM = new Map(PLAIN_WORDS.flatMap((entry) => entry.forms.map((form) => [form, entry] as const)));

/** The entries whose words appear in `texts`, in list order, each once. */
export function findPlainWords(texts: readonly string[]): PlainWord[] {
  const found = new Set<PlainWord>();
  for (const text of texts) {
    // Curly apostrophes and hyphens split words the same as spaces do here.
    for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
      const entry = BY_FORM.get(word);
      if (entry) found.add(entry);
    }
  }
  return PLAIN_WORDS.filter((entry) => found.has(entry));
}

/** Prompt text for the entries found in `texts`, one per line, or "(none)". */
export function formatPlainWords(texts: readonly string[]): string {
  const found = findPlainWords(texts);
  if (found.length === 0) return "(none)";
  return found.map((entry) => `- "${entry.forms[0]}": ${entry.plain}`).join("\n");
}
