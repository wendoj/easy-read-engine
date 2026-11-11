import { describe, expect, it } from "vitest";
import type { CheckResult } from "@/src/checker-client/schemas";
import {
  type LetterRecord,
  computeTotals,
  errorRecord,
  exitCodeFor,
  fileStamp,
  recordFromResult,
  selectLetters,
  summaryTable,
} from "@/src/fixtures/report";
import { type ConversionResult, NOTICE, RULES } from "@/src/pipeline";

// Every piece of letter content in the fake result carries this marker, so a
// leak anywhere in the record shows up as a substring.
const LEAK = "LEAKMARK";

function fakeResult(overrides: Partial<ConversionResult> = {}): ConversionResult {
  const checks: CheckResult[] = RULES.map((rule) => ({
    rule,
    passed: rule !== "P4" && rule !== "P10",
    line_ids: rule === "P4" ? ["L2", "L3"] : rule === "P10" ? ["L1"] : [],
    failed_fact_ids: [],
    details: [`${LEAK} detail quoting a line for ${rule}`],
  }));
  return {
    status: "flagged",
    original: {
      text: `${LEAK} Dear resident, pay £45.00 by 1 April 2026.`,
      sentences: [{ id: "s1", text: `${LEAK} sentence`, start: 0, end: 10 }],
    },
    keyFacts: [
      { id: "k1", type: "money", value: `${LEAK} £45.00`, normalised: `${LEAK}45.00`, start: 0, end: 5, sentence_id: "s1" },
    ],
    lines: [
      { id: "L1", text: `${LEAK} You need to pay £45.00.`, source_sentence_id: "s1", symbol_id: `${LEAK}sym` },
      { id: "L2", text: `${LEAK} line 2`, source_sentence_id: "s1", symbol_id: null },
      { id: "L3", text: `${LEAK} line 3`, source_sentence_id: "s1", symbol_id: null },
    ],
    checks,
    attempts: 3,
    notice: NOTICE,
    judgeAvailable: true,
    models: [
      { task: "rewrite", attempt: 1, provider: "groq", model: "openai/gpt-oss-120b" },
      { task: "judge", attempt: 1, provider: "groq", model: "qwen/qwen3.8-27b" },
      { task: "regenerate", attempt: 1, provider: "groq", model: "openai/gpt-oss-120b" },
    ],
    actionSynonyms: [{ word: `${LEAK}contact`, counts_as: "phone" }],
    ...overrides,
  };
}

const counts = { total: 4, ok: 3, outcomes: { ok: 3, rate_limited: 1 } };
const letter = { file: "invented-parking-penalty.txt", source: "txt" as const };

describe("selectLetters", () => {
  const files = [
    "README.md",
    "invented-b.txt",
    "invented-a.txt",
    "public.pdf",
    "public.txt",
    "other.txt",
    "notes.odt",
  ];

  it("default set is the invented .txt letters, sorted", () => {
    expect(selectLetters(files, "default")).toEqual([
      { file: "invented-a.txt", source: "txt" },
      { file: "invented-b.txt", source: "txt" },
    ]);
  });

  it("--all takes every letter once, preferring a PDF over a .txt with the same name", () => {
    expect(selectLetters(files, "all")).toEqual([
      { file: "invented-a.txt", source: "txt" },
      { file: "invented-b.txt", source: "txt" },
      { file: "other.txt", source: "txt" },
      { file: "public.pdf", source: "pdf" },
    ]);
  });
});

describe("recordFromResult", () => {
  it("keeps rule results, attempts, status and models", () => {
    const r = recordFromResult(letter, fakeResult(), { ms: 1234, requests: counts });
    expect(r.status).toBe("flagged");
    expect(r.attempts).toBe(3);
    expect(r.failedRules).toEqual(["P4", "P10"]);
    expect(r.rules?.P4).toEqual({ passed: false, failingLines: 2, failedFacts: 0 });
    expect(r.rules?.P1.passed).toBe(true);
    expect(Object.keys(r.rules ?? {})).toEqual([...RULES]);
    expect(r.answeredBy).toEqual(["groq:openai/gpt-oss-120b", "groq:qwen/qwen3.8-27b"]);
    expect(r).toMatchObject({ sentenceCount: 1, keyFactCount: 1, lineCount: 3, requests: counts });
  });

  it("holds no letter text, lines, details or key-fact values", () => {
    const r = recordFromResult(letter, fakeResult(), { ms: 1, requests: counts });
    const json = JSON.stringify(r);
    expect(json).not.toContain(LEAK);
    expect(json).not.toContain("45.00");
    expect(r).not.toHaveProperty("lines");
    expect(r).not.toHaveProperty("keyFacts");
    expect(r).not.toHaveProperty("original");
  });

  it("treats a rule missing from checks as failed, never passed", () => {
    const result = fakeResult({ checks: fakeResult().checks.filter((c) => c.rule !== "P7") });
    const r = recordFromResult(letter, result, { ms: 1, requests: counts });
    expect(r.rules?.P7.passed).toBe(false);
    expect(r.failedRules).toContain("P7");
  });
});

describe("totals, exit code and table", () => {
  const passed = recordFromResult(
    { file: "a.txt", source: "txt" },
    fakeResult({ status: "passed", checks: fakeResult().checks.map((c) => ({ ...c, passed: true, line_ids: [] })) }),
    { ms: 1, requests: counts },
  );
  const flagged = recordFromResult({ file: "b.txt", source: "txt" }, fakeResult(), { ms: 1, requests: counts });
  const blocked = recordFromResult({ file: "c.pdf", source: "pdf" }, fakeResult({ status: "blocked", lines: [] }), {
    ms: 1,
    requests: counts,
  });
  const failedRun = errorRecord({ file: "d.txt", source: "txt" }, "providers_unavailable", { ms: 1, requests: counts });

  it("counts statuses and rule passes over finished letters only", () => {
    const t = computeTotals([passed, flagged, blocked, failedRun]);
    expect(t).toMatchObject({ letters: 4, finished: 3, errors: 1, passed: 1, flagged: 1, blocked: 1 });
    expect(t.rulePasses.P1).toBe(3);
    expect(t.rulePasses.P4).toBe(1);
  });

  it("exits 0 when every letter finished, including flagged and blocked; 1 on an error", () => {
    expect(exitCodeFor([passed, flagged, blocked])).toBe(0);
    expect(exitCodeFor([passed, failedRun])).toBe(1);
  });

  it("prints one row per letter plus totals, with no letter content", () => {
    const records: LetterRecord[] = [passed, flagged, failedRun];
    const table = summaryTable(records);
    const rows = table.split("\n");
    expect(rows).toHaveLength(2 + records.length + 2);
    expect(rows[0]).toMatch(/^letter\s+status\s+tries\s+P1\s+P2/);
    expect(table).toContain("error: providers_unavailable");
    expect(rows[3]).toMatch(/^b\.txt\s+flagged\s+3\s+ok\s+ok\s+ok\s+FAIL/);
    expect(rows.at(-1)).toContain("total (2/3 finished)");
    expect(table).not.toContain(LEAK);
  });

  it("makes a file-name-safe timestamp", () => {
    expect(fileStamp(new Date("2026-05-14T09:30:12.345Z"))).toBe("20260514T093012Z");
  });
});
