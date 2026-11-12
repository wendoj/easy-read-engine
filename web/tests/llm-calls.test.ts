import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { CheckResult, KeyFact, Line, Sentence } from "@/src/checker-client/schemas";
import {
  buildJudgeMessages,
  type ChatMessage,
  type LineVerdict,
  type ModelConfig,
  type ModelLogEvent,
  type StructuredLogEvent,
  type Transport,
  type TransportResponse,
  type JudgePair,
  JUDGE_BATCH_LINES,
  JUDGE_UNAVAILABLE,
  ModelOutputError,
  NO_CONTEXT,
  REWRITE_CHUNK_SENTENCES,
  buildJudgeResults,
  chunkSentences,
  buildRegenerateMessages,
  buildRewriteMessages,
  collectFailures,
  createModelClient,
  judge,
  judgeBatches,
  loadPrompt,
  parsePrompt,
  regenerate,
  renderTemplate,
  rewrite,
} from "@/src/llm";

// --- fake model client ------------------------------------------------------------
// The real model client with a scripted transport: no network, no real models.

type Reply =
  | { tool: string; args: unknown }
  | { content: string }
  | { status: number };

interface SentBody {
  messages: ChatMessage[];
  tools?: { function: { name: string } }[];
  tool_choice?: unknown;
}

function reply(r: Reply): TransportResponse {
  if ("status" in r) return { status: r.status, headers: {}, json: { error: { code: "tool_use_failed" } } };
  const message =
    "tool" in r
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: r.tool, arguments: typeof r.args === "string" ? r.args : JSON.stringify(r.args) },
            },
          ],
        }
      : { role: "assistant", content: r.content };
  return { status: 200, headers: {}, json: { choices: [{ message, finish_reason: "stop" }] } };
}

function fakeModel(replies: Reply[], chains: Partial<ModelConfig["chains"]> = {}) {
  const sent: SentBody[] = [];
  const clientLogs: ModelLogEvent[] = [];
  const taskLogs: StructuredLogEvent[] = [];
  const queue = [...replies];
  const transport: Transport = async (req) => {
    sent.push(req.body as SentBody);
    const next = queue.shift();
    if (!next) throw new Error("fake model: no reply left");
    return reply(next);
  };
  const config: ModelConfig = {
    appEnv: "development",
    chains: {
      rewrite: [{ provider: "groq", model: "openai/gpt-oss-120b" }],
      judge: [{ provider: "groq", model: "qwen/qwen3.8-27b" }],
      vision: [{ provider: "groq", model: "qwen/qwen3.8-27b" }],
      ...chains,
    },
    keys: { groq: "test-key" },
  };
  const client = createModelClient({ config, transport, logger: (e) => clientLogs.push(e) });
  return { client, sent, clientLogs, taskLogs, logger: (e: StructuredLogEvent) => taskLogs.push(e) };
}

const userText = (body: SentBody) =>
  body.messages.filter((m) => m.role === "user").map((m) => String(m.content)).join("\n");

// --- invented letter data (no real personal data) ----------------------------------

const SECRET_AMOUNT = "£1,461.60";
const SECRET_REF = "NB123456";

const sentences: Sentence[] = [
  { id: "s1", text: "Northbridge Borough Council\nCouncil Tax reminder.", start: 0, end: 49 },
  { id: "s2", text: `You must pay ${SECRET_AMOUNT} by 1 April 2026.`, start: 50, end: 90 },
  { id: "s3", text: `Your reference is ${SECRET_REF}.`, start: 91, end: 120 },
];

const keyFacts: KeyFact[] = [
  { id: "k1", type: "money", value: SECRET_AMOUNT, normalised: "146160 GBP", start: 63, end: 72, sentence_id: "s2" },
  { id: "k2", type: "date", value: "1 April 2026", normalised: "2026-04-01", start: 76, end: 88, sentence_id: "s2" },
  { id: "k3", type: "reference", value: SECRET_REF, normalised: SECRET_REF, start: 109, end: 117, sentence_id: "s3" },
];

const goodLines = {
  lines: [
    { text: "This letter is from Northbridge Borough Council.", sourceSentenceId: "s1", symbolQuery: "letter" },
    { text: `You must pay ${SECRET_AMOUNT} by 1 April 2026.`, sourceSentenceId: "s2", symbolQuery: "pay" },
    { text: `Your reference number is ${SECRET_REF}.`, sourceSentenceId: "s3", symbolQuery: "" },
  ],
};

const PROMPT = parsePrompt(
  "## System\nSYSTEM RULES\n## User\nS:\n{{sentences}}\nC:\n{{context}}\nK:\n{{key_facts}}\nW:\n{{plain_words}}",
);
/** The part of a rewrite request before "C:": the sentences to rewrite. */
const toRewrite = (body: SentBody) => userText(body).split("\nC:\n")[0];
/** The part of a rewrite request between "C:" and "K:": context only. */
const contextOf = (body: SentBody) => userText(body).split("\nC:\n")[1].split("\nK:\n")[0];

// --- rewrite: tool call, zod validation and the one retry ----------------------------

describe("rewrite", () => {
  it("asks for the submit_lines tool and returns validated lines", async () => {
    const m = fakeModel([{ tool: "submit_lines", args: goodLines }]);
    const result = await rewrite(m.client, { sentences, keyFacts }, { prompt: PROMPT, logger: m.logger });
    expect(result.lines).toEqual(goodLines.lines);
    expect(result.requests).toBe(1);
    expect(result.provider).toBe("groq");
    expect(result.model).toBe("openai/gpt-oss-120b");
    expect(m.sent[0].tools?.map((t) => t.function.name)).toEqual(["submit_lines"]);
    expect(m.sent[0].tool_choice).toEqual({ type: "function", function: { name: "submit_lines" } });
    // Key facts from the Original are passed in so the model can copy them.
    expect(userText(m.sent[0])).toContain(`k1 (money, from s2): ${SECRET_AMOUNT}`);
    expect(userText(m.sent[0])).toContain("s1: Northbridge Borough Council Council Tax reminder.");
  });

  it("retries once on invalid JSON, then succeeds", async () => {
    const m = fakeModel([
      { tool: "submit_lines", args: "{not json" },
      { tool: "submit_lines", args: goodLines },
    ]);
    const result = await rewrite(m.client, { sentences, keyFacts }, { prompt: PROMPT, logger: m.logger });
    expect(result.requests).toBe(2);
    expect(m.sent).toHaveLength(2);
    expect(m.taskLogs.map((e) => e.outcome)).toEqual(["invalid", "valid"]);
  });

  it("retries once when the shape fails zod, then throws a clear error", async () => {
    const m = fakeModel([
      { tool: "submit_lines", args: { lines: [{ text: "", sourceSentenceId: "s1" }] } },
      { tool: "submit_lines", args: { lines: [] } },
    ]);
    const err = await rewrite(m.client, { sentences, keyFacts }, { prompt: PROMPT, logger: m.logger }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect(err.task).toBe("rewrite");
    expect(err.requests).toBe(2);
    expect(err.message).toBe('Model output for "rewrite" was not valid after 2 requests');
    expect(m.sent).toHaveLength(2);
  });

  it("rejects a line whose sourceSentenceId is not in the Original", async () => {
    const bad = { lines: [{ text: "You must pay.", sourceSentenceId: "s99", symbolQuery: "pay" }] };
    const m = fakeModel([
      { tool: "submit_lines", args: bad },
      { tool: "submit_lines", args: bad },
    ]);
    const err = await rewrite(m.client, { sentences, keyFacts }, { prompt: PROMPT, logger: m.logger }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect(err.issues.join(" ")).toContain("not a sentence ID from the list");
  });

  it("falls back to plain JSON without tools when the provider rejects the tool call (400)", async () => {
    const m = fakeModel([{ status: 400 }, { content: "```json\n" + JSON.stringify(goodLines) + "\n```" }]);
    const result = await rewrite(m.client, { sentences, keyFacts }, { prompt: PROMPT, logger: m.logger });
    expect(result.lines).toEqual(goodLines.lines);
    expect(result.requests).toBe(2);
    expect(m.sent[1].tools).toBeUndefined();
    expect(m.sent[1].tool_choice).toBeUndefined();
    expect(m.taskLogs.map((e) => [e.mode, e.outcome])).toEqual([
      ["tools", "tool_rejected"],
      ["content", "valid"],
    ]);
  });

  it("accepts valid arguments sent under a tool name that was not offered", async () => {
    const m = fakeModel([{ tool: "json", args: goodLines }]);
    const result = await rewrite(m.client, { sentences, keyFacts }, { prompt: PROMPT, logger: m.logger });
    expect(result.lines).toEqual(goodLines.lines);
    expect(result.requests).toBe(1);
  });

  it("throws a clear error when the tool call is rejected twice", async () => {
    const m = fakeModel([{ status: 400 }, { status: 400 }]);
    const err = await rewrite(m.client, { sentences, keyFacts }, { prompt: PROMPT, logger: m.logger }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect(err.requests).toBe(2);
  });

  it("splits a long letter into near-equal parts in order, and leaves a short one whole", () => {
    const ids = Array.from({ length: 143 }, (_, i) => i);
    const parts = chunkSentences(ids, REWRITE_CHUNK_SENTENCES);
    expect(parts.map((p) => p.length)).toEqual([48, 48, 47]);
    expect(parts.flat()).toEqual(ids);
    expect(chunkSentences(ids.slice(0, REWRITE_CHUNK_SENTENCES), REWRITE_CHUNK_SENTENCES)).toEqual([
      ids.slice(0, REWRITE_CHUNK_SENTENCES),
    ]);
    expect(chunkSentences([], 60)).toEqual([[]]);
  });

  it("rewrites a long letter in parts, each with only its own sentences and key facts", async () => {
    const many: Sentence[] = Array.from({ length: REWRITE_CHUNK_SENTENCES + 1 }, (_, i) => ({
      id: `s${i + 1}`,
      text: `Sentence number ${i + 1}.`,
      start: i * 20,
      end: i * 20 + 19,
    }));
    const last = `s${many.length}`;
    const facts: KeyFact[] = [
      { ...keyFacts[0], sentence_id: "s2" },
      { ...keyFacts[2], sentence_id: last },
    ];
    const part1 = { lines: [{ text: "Line from part 1.", sourceSentenceId: "s1", symbolQuery: "" }] };
    const part2 = { lines: [{ text: "Line from part 2.", sourceSentenceId: last, symbolQuery: "" }] };
    const m = fakeModel([
      { tool: "submit_lines", args: part1 },
      { tool: "submit_lines", args: part2 },
    ]);
    const result = await rewrite(m.client, { sentences: many, keyFacts: facts }, { prompt: PROMPT, logger: m.logger });
    expect(result.lines).toEqual([...part1.lines, ...part2.lines]);
    expect(result.requests).toBe(2);
    expect(m.sent).toHaveLength(2);
    expect(userText(m.sent[0])).toContain("s1: Sentence number 1.");
    expect(toRewrite(m.sent[0])).not.toContain(`${last}: `);
    expect(userText(m.sent[0])).toContain("k1 (money, from s2)");
    expect(userText(m.sent[0])).not.toContain("k3");
    expect(userText(m.sent[1])).toContain(`${last}: Sentence number ${many.length}.`);
    expect(toRewrite(m.sent[1])).not.toContain("s1: ");
    expect(userText(m.sent[1])).toContain(`k3 (reference, from ${last})`);
  });

  it("shows each part the start and end of the letter as context only (review v1)", async () => {
    // Regression: a later part never saw the letterhead, so it had to guess
    // the sender's name for "we".
    const many: Sentence[] = Array.from({ length: 2 * REWRITE_CHUNK_SENTENCES }, (_, i) => ({
      id: `s${i + 1}`,
      text: i === 0 ? "Northbridge Borough Council." : `Sentence number ${i + 1}.`,
      start: i * 30,
      end: i * 30 + 29,
    }));
    const n = many.length;
    const part1 = { lines: [{ text: "Line from part 1.", sourceSentenceId: "s1", symbolQuery: "" }] };
    const part2 = { lines: [{ text: "Line from part 2.", sourceSentenceId: `s${n}`, symbolQuery: "" }] };
    const m = fakeModel([
      { tool: "submit_lines", args: part1 },
      { tool: "submit_lines", args: part2 },
    ]);
    await rewrite(m.client, { sentences: many, keyFacts: [] }, { prompt: PROMPT, logger: m.logger });
    // Part 2 sees the first 5 sentences (the letterhead) as context, not as sentences to rewrite.
    expect(contextOf(m.sent[1])).toContain("s1: Northbridge Borough Council.");
    expect(contextOf(m.sent[1])).toContain("s5: ");
    expect(contextOf(m.sent[1])).not.toContain("s6: ");
    expect(toRewrite(m.sent[1])).not.toContain("s1: ");
    // Part 1 sees the last 3 sentences (the sign-off) as context.
    expect(contextOf(m.sent[0])).toContain(`s${n}: `);
    expect(contextOf(m.sent[0])).toContain(`s${n - 2}: `);
    expect(contextOf(m.sent[0])).not.toContain(`s${n - 3}: `);
    expect(contextOf(m.sent[0])).not.toContain("s1: ");
  });

  it("gives no context when the letter is rewritten in 1 request", async () => {
    const m = fakeModel([{ tool: "submit_lines", args: goodLines }]);
    await rewrite(m.client, { sentences, keyFacts }, { prompt: PROMPT, logger: m.logger });
    expect(contextOf(m.sent[0])).toBe(NO_CONTEXT);
  });

  it("records who answered each part, so a fallback on one part shows (review v1)", async () => {
    // Regression: only the last part's provider and model were kept.
    const many: Sentence[] = Array.from({ length: REWRITE_CHUNK_SENTENCES + 1 }, (_, i) => ({
      id: `s${i + 1}`,
      text: `Sentence number ${i + 1}.`,
      start: i * 20,
      end: i * 20 + 19,
    }));
    const part1 = { lines: [{ text: "Line from part 1.", sourceSentenceId: "s1", symbolQuery: "" }] };
    const part2 = { lines: [{ text: "Line from part 2.", sourceSentenceId: `s${many.length}`, symbolQuery: "" }] };
    const m = fakeModel([{ status: 500 }, { tool: "submit_lines", args: part1 }, { tool: "submit_lines", args: part2 }], {
      rewrite: [
        { provider: "groq", model: "first-model" },
        { provider: "groq", model: "second-model" },
      ],
    });
    const result = await rewrite(m.client, { sentences: many, keyFacts: [] }, { prompt: PROMPT, logger: m.logger });
    expect(result.answers).toEqual([
      { provider: "groq", model: "second-model" },
      { provider: "groq", model: "first-model" },
    ]);
    expect(result.model).toBe("first-model");
  });

  it("rejects a line in a later part that points at a sentence from an earlier part", async () => {
    const many: Sentence[] = Array.from({ length: REWRITE_CHUNK_SENTENCES + 1 }, (_, i) => ({
      id: `s${i + 1}`,
      text: `Sentence number ${i + 1}.`,
      start: i * 20,
      end: i * 20 + 19,
    }));
    const ok = { lines: [{ text: "Line.", sourceSentenceId: "s1", symbolQuery: "" }] };
    const m = fakeModel([
      { tool: "submit_lines", args: ok },
      { tool: "submit_lines", args: ok },
      { tool: "submit_lines", args: ok },
    ]);
    const err = await rewrite(m.client, { sentences: many, keyFacts: [] }, { prompt: PROMPT, logger: m.logger }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ModelOutputError);
    expect(err.issues.join(" ")).toContain("not a sentence ID from the list");
  });

  it("never logs prompts, letter text, model output or key-fact values", async () => {
    const m = fakeModel([{ tool: "submit_lines", args: "{bad" }, { tool: "submit_lines", args: goodLines }]);
    await rewrite(m.client, { sentences, keyFacts }, { prompt: PROMPT, logger: m.logger });
    const logged = JSON.stringify([m.taskLogs, m.clientLogs]);
    for (const secret of [SECRET_AMOUNT, SECRET_REF, "Northbridge", "SYSTEM RULES", "1 April 2026"]) {
      expect(logged).not.toContain(secret);
    }
    expect(m.taskLogs[0]).toMatchObject({ task: "rewrite", role: "rewrite", provider: "groq", attempt: 1 });
  });
});

// --- regenerate: only failing lines ---------------------------------------------------

const lines: Line[] = [
  { id: "L1", text: "This letter is from Northbridge Borough Council.", source_sentence_id: "s1", symbol_id: null },
  { id: "L2", text: "Payment of the amount must be made by you before the date.", source_sentence_id: "s2", symbol_id: "123" },
  { id: "L3", text: `Your reference number is ${SECRET_REF}.`, source_sentence_id: "s3", symbol_id: null },
];

const checks: CheckResult[] = [
  { rule: "P1", passed: false, line_ids: ["L2"], failed_fact_ids: ["k1"], details: ["k1 (money) is missing from the output"] },
  { rule: "P2", passed: true, line_ids: [], failed_fact_ids: [], details: [] },
  { rule: "P4", passed: false, line_ids: ["L2"], failed_fact_ids: [], details: ["L2 uses the passive voice"] },
];

const REGEN_PROMPT = parsePrompt(
  "## System\nFIX\n## User\n{{failing_lines}}\n--\n{{sentences}}\n--\n{{key_facts}}\n--\n{{missing_facts}}\n--\n{{plain_words}}",
);

describe("regenerate", () => {
  it("collects failures per line with rule IDs and checker details", () => {
    const failing = collectFailures(lines, checks, keyFacts);
    expect(failing.map((f) => f.line.id)).toEqual(["L2"]);
    expect(failing[0].failures).toEqual([
      { rule: "P1", details: ["k1 (money) is missing from the output"] },
      { rule: "P4", details: ["L2 uses the passive voice"] },
    ]);
  });

  it("sends only the failing lines and their context", () => {
    const failing = collectFailures(lines, checks, keyFacts);
    const { user } = buildRegenerateMessages(REGEN_PROMPT, { failing, sentences, keyFacts });
    expect(user).toContain("L2 (from s2): Payment of the amount");
    expect(user).toContain("  - P4: L2 uses the passive voice");
    expect(user).toContain(`k1 (money, from s2): ${SECRET_AMOUNT}`);
    expect(user).not.toContain("L1");
    expect(user).not.toContain("L3");
    expect(user).not.toContain(SECRET_REF); // s3 and k3 belong to a passing line
  });

  it("returns replacements for the failing IDs and keeps their source sentence", async () => {
    const m = fakeModel([
      {
        tool: "submit_replacements",
        args: {
          replacements: [
            {
              lineId: "L2",
              lines: [
                { text: `You must pay ${SECRET_AMOUNT}.`, sourceSentenceId: "s1", symbolQuery: "pay" },
                { text: "You must pay by 1 April 2026.", sourceSentenceId: "s2", symbolQuery: "calendar" },
              ],
            },
          ],
          added: [],
        },
      },
    ]);
    const failing = collectFailures(lines, checks, keyFacts);
    const result = await regenerate(m.client, { failing, sentences, keyFacts }, { prompt: REGEN_PROMPT, logger: m.logger });
    expect(result.replacements).toHaveLength(1);
    expect(result.replacements[0].lineId).toBe("L2");
    expect(result.replacements[0].lines.map((l) => l.sourceSentenceId)).toEqual(["s2", "s2"]);
    expect(result.added).toEqual([]);
    expect(m.sent[0].tools?.map((t) => t.function.name)).toEqual(["submit_replacements"]);
  });

  it("retries when a failing line ID has no replacement", async () => {
    const m = fakeModel([
      { tool: "submit_replacements", args: { replacements: [], added: [] } },
      {
        tool: "submit_replacements",
        args: { replacements: [{ lineId: "L2", lines: [{ text: "You must pay.", sourceSentenceId: "s2", symbolQuery: "" }] }], added: [] },
      },
    ]);
    const failing = collectFailures(lines, checks, keyFacts);
    const result = await regenerate(m.client, { failing, sentences, keyFacts }, { prompt: REGEN_PROMPT, logger: m.logger });
    expect(result.requests).toBe(2);
    expect(userText(m.sent[1])).toContain("a failing line ID has no replacement");
  });

  it("keeps the usable part of a reply with a wrong or repeated line ID, in one request", async () => {
    const good = { text: "You must pay.", sourceSentenceId: "s2", symbolQuery: "" };
    const m = fakeModel([
      {
        tool: "submit_replacements",
        args: {
          replacements: [
            { lineId: "L99", lines: [{ text: "Not a failing line.", sourceSentenceId: "s2", symbolQuery: "" }] },
            { lineId: "L2", lines: [good] },
            { lineId: "L2", lines: [{ text: "A second answer for L2.", sourceSentenceId: "s2", symbolQuery: "" }] },
          ],
          added: [{ text: "Not for a missing fact.", sourceSentenceId: "s1", symbolQuery: "" }],
        },
      },
    ]);
    const failing = collectFailures(lines, checks, keyFacts);
    const result = await regenerate(m.client, { failing, sentences, keyFacts }, { prompt: REGEN_PROMPT, logger: m.logger });
    expect(result.requests).toBe(1);
    expect(result.replacements).toEqual([{ lineId: "L2", lines: [good] }]);
    expect(result.added).toEqual([]);
  });

  it("accepts new lines for a missing fact's sentence only", async () => {
    const added = { text: `Your reference number is ${SECRET_REF}.`, sourceSentenceId: "s3", symbolQuery: "" };
    const m = fakeModel([{ tool: "submit_replacements", args: { replacements: [], added: [added] } }]);
    const result = await regenerate(
      m.client,
      { failing: [], sentences, keyFacts, missingFacts: [keyFacts[2]] },
      { prompt: REGEN_PROMPT, logger: m.logger },
    );
    expect(result.added).toEqual([added]);
    expect(userText(m.sent[0])).toContain(`k3 (reference, from s3): ${SECRET_REF}`);
  });
});

// --- judge: P9 and P10 ----------------------------------------------------------------

const pass = { verdict: "pass" as const, reason: "" };
const fail = (reason: string) => ({ verdict: "fail" as const, reason });
const JUDGE_PROMPT = parsePrompt("## System\nJUDGE\n## User\n{{pairs}}");
const pairs = lines.map((l) => ({
  lineId: l.id,
  sourceSentenceId: l.source_sentence_id,
  source: sentences.find((s) => s.id === l.source_sentence_id)!.text,
  line: l.text,
}));

describe("judge", () => {
  it("shows each line the other lines split from the same sentence", () => {
    const { user } = buildJudgeMessages(JUDGE_PROMPT, [
      { lineId: "L1", sourceSentenceId: "s1", source: "Pay £45 and send the form.", line: "You must pay £45." },
      { lineId: "L2", sourceSentenceId: "s1", source: "Pay £45 and send the form.", line: "You must send the form." },
      { lineId: "L3", sourceSentenceId: "s2", source: "Call us.", line: "Call the council." },
    ]);
    const blocks = user.split("\n\n");
    expect(blocks[0]).toContain("Other lines from this sentence: L2: You must send the form.");
    expect(blocks[1]).toContain("Other lines from this sentence: L1: You must pay £45.");
    expect(blocks[2]).not.toContain("Other lines");
  });

  it("does not share siblings between 2 sentences with the same text", () => {
    // Regression: siblings were grouped by sentence text, so a repeated
    // sentence showed the other copy's lines as its own.
    const { user } = buildJudgeMessages(JUDGE_PROMPT, [
      { lineId: "L1", sourceSentenceId: "s1", source: "Call us.", line: "Call the council." },
      { lineId: "L2", sourceSentenceId: "s4", source: "Call us.", line: "Phone the council." },
      { lineId: "L3", sourceSentenceId: "s4", source: "Call us.", line: "The council is open on Monday." },
    ]);
    const blocks = user.split("\n\n");
    expect(blocks[0]).not.toContain("Other lines");
    expect(blocks[1]).toContain("Other lines from this sentence: L3: The council is open on Monday.");
    expect(blocks[1]).not.toContain("L1:");
  });

  it("shows a context-only line as a sibling but gives it no block", () => {
    const { user } = buildJudgeMessages(JUDGE_PROMPT, [
      { lineId: "L1", sourceSentenceId: "s1", source: "Pay £45 and send the form.", line: "You must pay £45." },
      { lineId: "L2", sourceSentenceId: "s1", source: "Pay £45 and send the form.", line: "You must send the form.", contextOnly: true },
    ]);
    const blocks = user.split("\n\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("Line L1");
    expect(blocks[0]).toContain("Other lines from this sentence: L2: You must send the form.");
  });

  it("asks for and returns verdicts for judged lines only, not context-only lines", async () => {
    const m = fakeModel([
      { tool: "submit_verdicts", args: { verdicts: [{ lineId: "L1", meaning: pass, tone: pass, advice: pass }] } },
    ]);
    const withContext = pairs.map((p) => (p.lineId === "L1" ? p : { ...p, contextOnly: true }));
    const result = await judge(m.client, withContext, { prompt: JUDGE_PROMPT, logger: m.logger });
    expect(result.requests).toBe(1);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(userText(m.sent[0])).not.toContain("Line L2");
  });

  it("ignores a verdict for a context-only sibling and keeps the judged lines' verdicts", async () => {
    // Regression: an extra verdict for a context-only line failed validation,
    // so a valid edit came back as "judge unavailable" and export was turned off.
    const m = fakeModel([
      {
        tool: "submit_verdicts",
        args: {
          verdicts: [
            { lineId: "L1", meaning: fail("Adds a fact."), tone: pass, advice: pass },
            { lineId: "L2", meaning: pass, tone: pass, advice: fail("Tells the reader to appeal.") },
          ],
        },
      },
    ]);
    const withContext = pairs.map((p) => (p.lineId === "L1" ? p : { ...p, contextOnly: true }));
    const result = await judge(m.client, withContext, { prompt: JUDGE_PROMPT, logger: m.logger });
    const [p9, p10] = result.checks;
    expect(result.available).toBe(true);
    expect(result.requests).toBe(1);
    expect(p9.line_ids).toEqual(["L1"]);
    expect(p10.passed).toBe(true);
    expect([...p9.details, ...p10.details].some((d) => d.startsWith("L2"))).toBe(false);
  });

  it("ignores a verdict for an unknown line ID", async () => {
    const all = lines.map((l) => ({ lineId: l.id, meaning: pass, tone: pass, advice: pass }));
    const m = fakeModel([
      { tool: "submit_verdicts", args: { verdicts: [...all, { lineId: "L99", meaning: pass, tone: pass, advice: fail("x") }] } },
    ]);
    const result = await judge(m.client, pairs, { prompt: JUDGE_PROMPT, logger: m.logger });
    expect(result.available).toBe(true);
    expect(result.requests).toBe(1);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("still fails as 'judge unavailable' when a judged line has no verdict, even with extra verdicts", async () => {
    const extra = { lineId: "L2", meaning: pass, tone: pass, advice: pass };
    const onlyContext = { tool: "submit_verdicts", args: { verdicts: [extra] } };
    const m = fakeModel([onlyContext, onlyContext]);
    const withContext = pairs.map((p) => (p.lineId === "L1" ? p : { ...p, contextOnly: true }));
    const result = await judge(m.client, withContext, { prompt: JUDGE_PROMPT, logger: m.logger });
    expect(result.available).toBe(false);
    expect(result.requests).toBe(2);
    for (const check of result.checks) {
      expect(check.passed).toBe(false);
      expect(check.line_ids).toEqual(["L1"]);
      expect(check.details).toEqual([`L1 ${JUDGE_UNAVAILABLE}`]);
    }
  });

  it("batches whole sentences, with context-only siblings, up to the line limit", () => {
    const p = (lineId: string, sourceSentenceId: string, contextOnly = false): JudgePair => ({
      lineId, sourceSentenceId, source: "Source.", line: "Line.", ...(contextOnly ? { contextOnly } : {}),
    });  // prettier-ignore
    const all = [p("L1", "s1"), p("L2", "s1"), p("L3", "s2"), p("L4", "s2", true), p("L5", "s3"), p("L6", "s4", true)];
    const ids = (batches: JudgePair[][]) => batches.map((b) => b.map((x) => x.lineId));
    expect(ids(judgeBatches(all, 3))).toEqual([["L1", "L2", "L3", "L4"], ["L5"]]);
    expect(ids(judgeBatches(all, 1))).toEqual([["L1", "L2"], ["L3", "L4"], ["L5"]]);
    expect(ids(judgeBatches(all, JUDGE_BATCH_LINES))).toEqual([["L1", "L2", "L3", "L4", "L5"]]);
  });

  it("judges many lines in batches and keeps every batch's verdicts", async () => {
    const many: JudgePair[] = Array.from({ length: JUDGE_BATCH_LINES + 2 }, (_, i) => ({
      lineId: `L${i + 1}`, sourceSentenceId: `s${i + 1}`, source: "Call us.", line: "Call the council.",
    }));  // prettier-ignore
    const verdictsFor = (from: number, to: number) => ({
      tool: "submit_verdicts",
      args: {
        verdicts: many.slice(from, to).map((x) => ({
          lineId: x.lineId, meaning: x.lineId === "L41" ? fail("Adds a fact.") : pass, tone: pass, advice: pass,
        })),  // prettier-ignore
      },
    });
    const m = fakeModel([verdictsFor(0, JUDGE_BATCH_LINES), verdictsFor(JUDGE_BATCH_LINES, many.length)]);
    const result = await judge(m.client, many, { prompt: JUDGE_PROMPT, logger: m.logger });
    expect(m.sent).toHaveLength(2);
    expect(userText(m.sent[0])).not.toContain("Line L41");
    expect(userText(m.sent[1])).toContain("Line L41");
    expect(result.available).toBe(true);
    expect(result.requests).toBe(2);
    expect(result.checks[0].line_ids).toEqual(["L41"]);
    expect(result.checks[1].passed).toBe(true);
  });

  it("fails only a failed batch's lines as 'judge unavailable', in line order", async () => {
    const many: JudgePair[] = Array.from({ length: JUDGE_BATCH_LINES + 2 }, (_, i) => ({
      lineId: `L${i + 1}`, sourceSentenceId: `s${i + 1}`, source: "Call us.", line: "Call the council.",
    }));  // prettier-ignore
    const first = {
      tool: "submit_verdicts",
      args: {
        verdicts: many.slice(0, JUDGE_BATCH_LINES).map((x) => ({
          lineId: x.lineId, meaning: x.lineId === "L2" ? fail("Adds a fact.") : pass, tone: pass, advice: pass,
        })),  // prettier-ignore
      },
    };
    const broken = { tool: "submit_verdicts", args: "{cut off" };
    const m = fakeModel([first, broken, broken]);
    const result = await judge(m.client, many, { prompt: JUDGE_PROMPT, logger: m.logger });
    const [p9, p10] = result.checks;
    expect(result.available).toBe(false);
    expect(result.requests).toBe(3);
    expect(p9.line_ids).toEqual(["L2", "L41", "L42"]);
    expect(p9.details).toEqual(["L2 meaning: Adds a fact.", `L41 ${JUDGE_UNAVAILABLE}`, `L42 ${JUDGE_UNAVAILABLE}`]);
    expect(p10.line_ids).toEqual(["L41", "L42"]);
    // Review v1: the unanswered lines are named, and each answered batch is recorded.
    expect(result.unavailableLineIds).toEqual(["L41", "L42"]);
    expect(result.answers).toEqual([{ provider: "groq", model: "qwen/qwen3.8-27b" }]);
  });

  it("makes no request when every pair is context only", async () => {
    const m = fakeModel([]);
    const result = await judge(m.client, pairs.map((p) => ({ ...p, contextOnly: true })), { prompt: JUDGE_PROMPT });
    expect(result.requests).toBe(0);
    expect(m.sent).toHaveLength(0);
  });

  it("returns P9 and P10 with the failing line IDs", async () => {
    const m = fakeModel([
      {
        tool: "submit_verdicts",
        args: {
          verdicts: [
            { lineId: "L1", meaning: pass, tone: pass, advice: pass },
            { lineId: "L2", meaning: fail("Adds a fact."), tone: pass, advice: pass },
            { lineId: "L3", meaning: pass, tone: pass, advice: fail("Tells the reader to appeal.") },
          ],
        },
      },
    ]);
    const result = await judge(m.client, pairs, { prompt: JUDGE_PROMPT, logger: m.logger });
    const [p9, p10] = result.checks;
    expect(result.available).toBe(true);
    expect(p9).toEqual({ rule: "P9", passed: false, line_ids: ["L2"], failed_fact_ids: [], details: ["L2 meaning: Adds a fact."] });
    expect(p10).toEqual({
      rule: "P10",
      passed: false,
      line_ids: ["L3"],
      failed_fact_ids: [],
      details: ["L3 advice: Tells the reader to appeal."],
    });
    expect(m.sent[0].tools?.map((t) => t.function.name)).toEqual(["submit_verdicts"]);
    expect(result.model).toBe("qwen/qwen3.8-27b");
  });

  it("retries when a line has no verdict", async () => {
    const all = lines.map((l) => ({ lineId: l.id, meaning: pass, tone: pass, advice: pass }));
    const m = fakeModel([
      { tool: "submit_verdicts", args: { verdicts: all.slice(0, 2) } },
      { tool: "submit_verdicts", args: { verdicts: all } },
    ]);
    const result = await judge(m.client, pairs, { prompt: JUDGE_PROMPT, logger: m.logger });
    expect(result.requests).toBe(2);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails P9 and P10 on every line as 'judge unavailable' after the retry", async () => {
    const m = fakeModel([{ content: "no json here" }, { content: "still none" }]);
    const result = await judge(m.client, pairs, { prompt: JUDGE_PROMPT, logger: m.logger });
    expect(result.available).toBe(false);
    for (const check of result.checks) {
      expect(check.passed).toBe(false);
      expect(check.line_ids).toEqual(["L1", "L2", "L3"]);
      expect(check.details).toContain(`L1 ${JUDGE_UNAVAILABLE}`);
    }
  });

  it("fails both rules for a line with no verdict in buildJudgeResults", () => {
    const [p9, p10] = buildJudgeResults(["L1", "L2"], [{ lineId: "L1", meaning: pass, tone: pass, advice: pass }]);
    expect(p9.line_ids).toEqual(["L2"]);
    expect(p10.line_ids).toEqual(["L2"]);
  });

  /**
   * Property: a line with a failed advice verdict always fails P10.
   * **Validates: Requirements 7.2, 7.3; P10**
   */
  it("property: a failed advice verdict always fails P10 for that line", () => {
    const verdictArb = fc.record({
      verdict: fc.constantFrom<"pass" | "fail">("pass", "fail"),
      reason: fc.string({ maxLength: 40 }),
    });
    const scenario = fc
      .uniqueArray(fc.stringMatching(/^L[0-9]{1,3}$/), { minLength: 1, maxLength: 30 })
      .chain((ids) =>
        fc.record({
          ids: fc.constant(ids),
          verdicts: fc.tuple(
            ...ids.map((lineId) =>
              fc.record({ lineId: fc.constant(lineId), meaning: verdictArb, tone: verdictArb, advice: verdictArb }),
            ),
          ),
          extra: fc.array(
            fc.record({ lineId: fc.constantFrom(...ids), meaning: verdictArb, tone: verdictArb, advice: verdictArb }),
            { maxLength: 5 },
          ),
        }),
      );
    fc.assert(
      fc.property(scenario, ({ ids, verdicts, extra }) => {
        const all: LineVerdict[] = [...verdicts, ...extra];
        const [, p10] = buildJudgeResults(ids, all);
        const firstById = new Map<string, LineVerdict>();
        for (const v of all) if (!firstById.has(v.lineId)) firstById.set(v.lineId, v);
        for (const id of ids) {
          if (firstById.get(id)?.advice.verdict === "fail") {
            expect(p10.passed).toBe(false);
            expect(p10.line_ids).toContain(id);
            expect(p10.details.some((d) => d.startsWith(`${id} advice`))).toBe(true);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});

// --- prompt files -----------------------------------------------------------------------

describe("prompt files", () => {
  it("rewrite and regenerate include the no-advice rule", async () => {
    for (const name of ["rewrite", "regenerate"] as const) {
      const prompt = await loadPrompt(name);
      expect(prompt.system).toContain("**Never give advice.**");
      expect(prompt.system).toMatch(/unless the letter itself asks them to do it/);
    }
  });

  it("judge checks advice, and vision checks handwriting first", async () => {
    const judgePrompt = await loadPrompt("judge");
    expect(judgePrompt.system).toContain("### 3. Advice (P10)");
    const vision = await loadPrompt("vision");
    expect(vision.system.indexOf("Step 1: printed or handwritten")).toBeGreaterThan(-1);
    expect(vision.system.indexOf("Step 1")).toBeLessThan(vision.system.indexOf("Step 3"));
  });

  it("every placeholder in the real prompts is filled by the code", async () => {
    const rw = await loadPrompt("rewrite");
    expect(() => buildRewriteMessages(rw, { sentences, keyFacts })).not.toThrow();
    const rg = await loadPrompt("regenerate");
    const failing = collectFailures(lines, checks, keyFacts);
    expect(() => buildRegenerateMessages(rg, { failing, sentences, keyFacts })).not.toThrow();
    const jd = await loadPrompt("judge");
    expect(() => renderTemplate(jd.user, { pairs: "x" })).not.toThrow();
  });

  it("renderTemplate never treats $ in letter text as a pattern", () => {
    expect(renderTemplate("a {{x}} b", { x: "$& $1 $$" })).toBe("a $& $1 $$ b");
  });
});
