import { describe, expect, it } from "vitest";
import { buildRewriteMessages } from "@/src/llm/rewrite";
import { loadPrompt } from "@/src/llm/prompts";
import { PLAIN_WORDS, findPlainWords, formatPlainWords } from "@/src/llm/plain-words";
import { splitCondition, splitConditions } from "@/src/pipeline/split-conditions";

describe("plain words", () => {
  it("finds each hard word once, in any form, in list order", () => {
    const found = findPlainWords(["You got a Summons.", "Pay in 3 instalments.", "The summonses were sent."]);
    expect(found.map((e) => e.forms[0])).toEqual(["instalment", "summons"]);
  });

  it("matches whole words only", () => {
    expect(findPlainWords(["The venues", "a tenantless flat"])).toEqual([]);
  });

  it("formats the entries, or (none)", () => {
    expect(formatPlainWords(["You are in arrears."])).toBe('- "arrears": money you owe');
    expect(formatPlainWords(["You must pay £45."])).toBe("(none)");
  });

  it("puts the swaps for the letter's hard words in the rewrite prompt", async () => {
    const prompt = await loadPrompt("rewrite");
    const sentences = [{ id: "s1", text: "Your arrears must be paid in instalments.", start: 0, end: 41 }];
    const { user } = buildRewriteMessages(prompt, { sentences, keyFacts: [] });
    expect(user).toContain('- "arrears": money you owe\n- "instalment": smaller payments');
  });

  it("lists each form once", () => {
    const forms = PLAIN_WORDS.flatMap((e) => e.forms);
    expect(new Set(forms).size).toBe(forms.length);
    expect(forms.every((f) => f === f.toLowerCase())).toBe(true);
  });
});

describe("splitCondition", () => {
  it.each([
    ["If you can't pay, we can help.", ["Maybe you can't pay.", "Then we can help."]],
    ["If you think your bill is wrong, then please tell us.", ["Maybe you think your bill is wrong.", "Then please tell us."]],
    ["If you owe £1,000, call the council.", ["Maybe you owe £1,000.", "Then call the council."]],
    ["If you have a question, can you phone us?", ["Maybe you have a question.", "Then can you phone us?"]],
  ])("splits %s", (text, lines) => {
    expect(splitCondition(text)).toEqual(lines);
  });

  it.each([
    ["You can claim Council Tax Support if your income is low.", ["Maybe your income is low.", "Then you can claim Council Tax Support."]],
    ["You can get money off your bill if you qualify.", ["Maybe you qualify.", "Then you can get money off your bill."]],
    ["Call us if you owe more than £50.", ["Maybe you owe more than £50.", "Then call us."]],
  ])("splits the trailing if in %s", (text, lines) => {
    expect(splitCondition(text)).toEqual(lines);
  });

  it.each([
    ["You have missed a payment, and we want to help.", ["You have missed a payment.", "We want to help."]],
    ["You owe £1,000, and we want it.", ["You owe £1,000.", "We want it."]],
    ["The council got your form, and it will reply by 14 March 2026.", ["The council got your form.", "It will reply by 14 March 2026."]],
  ])("splits the joined clauses in %s", (text, lines) => {
    expect(splitCondition(text)).toEqual(lines);
  });

  it.each([
    "You must pay, and you must pay today.. Now.",
    "Pay now, and then wait.",
  ])("leaves the joined clauses in %s alone", (text) => {
    expect(splitCondition(text)).toBeNull();
  });

  it.each([
    "You can get extra help even if you do not qualify.",
    "Check if you can get help.",
    "Pay it if you can.",
    "Please pay by direct debit if you can at www.manchester.gov.uk/directdebit.",
    "Citizens Advice can help if you ask them.",
    "You can pay online if you like. You can also phone.",
  ])("leaves the trailing if in %s alone", (text) => {
    expect(splitCondition(text)).toBeNull();
  });

  it.each([
    "You can pay online.",
    "Please pay now if you can.",
    "If so, pay now.",
    "If you moved, or your income changed, tell the council.",
    "If you are interested but cannot access the guidance online,",
    "If you can't pay, call. The number is below.",
    "If you can't pay, phone.",
    "When the decision is made, it will be online.",
  ])("leaves %s alone", (text) => {
    expect(splitCondition(text)).toBeNull();
  });

  it("keeps the source sentence and gives the picture to the Then line", () => {
    const out = splitConditions([
      { text: "If you can't pay, we can help.", sourceSentenceId: "s4", symbolQuery: "help" },
      { text: "Pay by 1 April 2026.", sourceSentenceId: "s5", symbolQuery: "calendar" },
    ]);
    expect(out).toEqual([
      { text: "Maybe you can't pay.", sourceSentenceId: "s4", symbolQuery: "" },
      { text: "Then we can help.", sourceSentenceId: "s4", symbolQuery: "help" },
      { text: "Pay by 1 April 2026.", sourceSentenceId: "s5", symbolQuery: "calendar" },
    ]);
  });
});
