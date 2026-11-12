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
