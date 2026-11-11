/**
 * Pure parts of the fixture run (task 19, design "Fixture run"): choosing the
 * letters, shaping each `ConversionResult` into a record, and the summary
 * table. `web/scripts/fixtures.ts` does the I/O.
 *
 * A record holds rule results and metadata only: file name, status, attempts,
 * pass or fail per rule, counts, and which provider and model answered. It
 * never holds letter text, sentences, Easy Read lines, check details or
 * key-fact values (R7.4). Records are built field by field from an allowlist,
 * never by copying the result, so a new field on `ConversionResult` can't leak.
 */
import { RULES } from "@/src/pipeline/decide";
import type { ConversionResult, ModelUse, Rule, Status } from "@/src/pipeline/types";

/** Letters converted by plain `npm run fixtures`: the prompt-hook set. */
export const DEFAULT_SET_PREFIX = "invented-";
export const DEFAULT_SET_SIZE = 5;
/** Used by `--all` when it exists (task 31: the 20 public sample letters). */
export const PASS_RATE_DIR = "pass-rate";

export type LetterSet = "default" | "all";
export type LetterSource = "txt" | "pdf";

export interface FixtureLetter {
  /** File name relative to the letters folder. */
  file: string;
  source: LetterSource;
}

/**
 * Pick the letters to convert from a folder listing.
 * - `default`: the `invented-*.txt` letters.
 * - `all`: every `.txt` and `.pdf`. A PDF wins over a `.txt` with the same
 *   base name, so the PDF goes through the real extractor and the letter is
 *   converted once.
 */
export function selectLetters(files: readonly string[], set: LetterSet): FixtureLetter[] {
  const sorted = [...files].sort();
  if (set === "default") {
    return sorted
      .filter((f) => f.startsWith(DEFAULT_SET_PREFIX) && f.endsWith(".txt"))
      .map((file) => ({ file, source: "txt" }));
  }
  const pdfBases = new Set(sorted.filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -".pdf".length)));
  return sorted.flatMap((file): FixtureLetter[] => {
    if (file.endsWith(".pdf")) return [{ file, source: "pdf" }];
    if (file.endsWith(".txt") && !pdfBases.has(file.slice(0, -".txt".length))) return [{ file, source: "txt" }];
    return [];
  });
}

export interface RuleRecord {
  passed: boolean;
  /** How many lines the rule failed on. 0 when it passed. */
  failingLines: number;
  /** P1 only: how many key facts were missing or changed. */
  failedFacts: number;
}

/** Infrastructure or input failure for one letter. Codes only, no messages. */
export type LetterErrorCode =
  | "checker_unavailable"
  | "providers_unavailable"
  | "model_output_invalid"
  | "internal"
  | "too_long"
  | "empty"
  | "pdf_no_text_layer"
  | "pdf_too_many_pages"
  | "pdf_unreadable";

export interface ModelRequestCounts {
  /** Every HTTP request to a provider, including fallbacks and retries. */
  total: number;
  ok: number;
  /** Outcome name to count, for example `rate_limited: 1`. */
  outcomes: Record<string, number>;
}

export interface LetterRecord {
  letter: string;
  source: LetterSource;
  ms: number;
  requests: ModelRequestCounts;
  /** Set when the letter didn't finish. The fields below are then absent. */
  error?: LetterErrorCode;
  /** Error class name for `internal`, to tell failures apart. */
  errorName?: string;
  status?: Status;
  attempts?: number;
  judgeAvailable?: boolean;
  sentenceCount?: number;
  keyFactCount?: number;
  lineCount?: number;
  rules?: Record<Rule, RuleRecord>;
  failedRules?: Rule[];
  models?: ModelUse[];
  /** Distinct `provider:model` values that answered, in first-use order. */
  answeredBy?: string[];
}

export interface RunReport {
  kind: "easy-read-fixture-run";
  version: 1;
  startedAt: string;
  finishedAt: string;
  set: LetterSet;
  /** Folder the letters came from, relative to the repo root. */
  lettersDir: string;
  appEnv: string;
  /** `provider:model` chains from the environment, per role. Names only, never keys. */
  chains: Record<string, string[]>;
  letters: LetterRecord[];
  totals: RunTotals;
}

export interface RunTotals {
  letters: number;
  finished: number;
  errors: number;
  passed: number;
  flagged: number;
  blocked: number;
  /** Letters that passed each rule, out of `finished`. */
  rulePasses: Record<Rule, number>;
}

const modelUse = (m: ModelUse): ModelUse => ({ task: m.task, attempt: m.attempt, provider: m.provider, model: m.model });

/** Shape one finished conversion. Copies counts and rule results only. */
export function recordFromResult(
  letter: FixtureLetter,
  result: ConversionResult,
  meta: { ms: number; requests: ModelRequestCounts },
): LetterRecord {
  const rules = Object.fromEntries(
    RULES.map((rule) => {
      const c = result.checks.find((x) => x.rule === rule);
      // checks always holds all 10 rules; a missing one is reported as failed, never passed.
      const passed = c?.passed ?? false;
      return [rule, { passed, failingLines: passed ? 0 : (c?.line_ids.length ?? 0), failedFacts: c?.failed_fact_ids.length ?? 0 }];
    }),
  ) as Record<Rule, RuleRecord>;
  const models = result.models.map(modelUse);
  return {
    letter: letter.file,
    source: letter.source,
    ms: meta.ms,
    requests: copyCounts(meta.requests),
    status: result.status,
    attempts: result.attempts,
    judgeAvailable: result.judgeAvailable,
    sentenceCount: result.original.sentences.length,
    keyFactCount: result.keyFacts.length,
    lineCount: result.lines.length,
    rules,
    failedRules: RULES.filter((r) => !rules[r].passed),
    models,
    answeredBy: [...new Set(models.map((m) => `${m.provider}:${m.model}`))],
  };
}

export function errorRecord(
  letter: FixtureLetter,
  error: LetterErrorCode,
  meta: { ms: number; requests: ModelRequestCounts; errorName?: string },
): LetterRecord {
  return {
    letter: letter.file,
    source: letter.source,
    ms: meta.ms,
    requests: copyCounts(meta.requests),
    error,
    ...(error === "internal" && meta.errorName ? { errorName: meta.errorName } : {}),
  };
}

function copyCounts(c: ModelRequestCounts): ModelRequestCounts {
  return { total: c.total, ok: c.ok, outcomes: { ...c.outcomes } };
}

export function computeTotals(records: readonly LetterRecord[]): RunTotals {
  const finished = records.filter((r) => r.status !== undefined);
  return {
    letters: records.length,
    finished: finished.length,
    errors: records.length - finished.length,
    passed: finished.filter((r) => r.status === "passed").length,
    flagged: finished.filter((r) => r.status === "flagged").length,
    blocked: finished.filter((r) => r.status === "blocked").length,
    rulePasses: Object.fromEntries(RULES.map((rule) => [rule, finished.filter((r) => r.rules?.[rule].passed).length])) as Record<
      Rule,
      number
    >,
  };
}

/** Exit code: 0 when every letter finished (passed, flagged or blocked), 1 otherwise. */
export function exitCodeFor(records: readonly LetterRecord[]): number {
  return records.every((r) => r.status !== undefined) ? 0 : 1;
}

/** `20260514T093012Z`, safe in file names. */
export function fileStamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** Plain-text summary table for stdout. */
export function summaryTable(records: readonly LetterRecord[]): string {
  const header = ["letter", "status", "tries", ...RULES, "answered by"];
  const rows = records.map((r) => [
    r.letter,
    r.status ?? `error: ${r.error ?? "unknown"}`,
    r.attempts === undefined ? "-" : String(r.attempts),
    ...RULES.map((rule) => (r.rules ? (r.rules[rule].passed ? "ok" : "FAIL") : "-")),
    r.answeredBy?.join(", ") ?? "-",
  ]);
  const t = computeTotals(records);
  const totals = [
    `total (${t.finished}/${t.letters} finished)`,
    `${t.passed}P ${t.flagged}F ${t.blocked}B`,
    "",
    ...RULES.map((rule) => `${t.rulePasses[rule]}/${t.finished}`),
    "",
  ];
  const all = [header, ...rows, totals];
  const widths = header.map((_, i) => Math.max(...all.map((row) => row[i].length)));
  const fmt = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  return [fmt(header), rule, ...rows.map(fmt), rule, fmt(totals)].join("\n");
}
