/**
 * Fixture run (task 19, design "Fixture run"). Converts fixture letters one at
 * a time through the full pipeline (all 10 checks) and records, per letter,
 * pass or fail per rule, attempts, status and the provider and model that
 * answered.
 *
 *   npm run fixtures            the 5 invented-*.txt letters (prompt-hook set)
 *   npm run fixtures -- --all   pass-rate run (task 31): every letter in
 *                               fixtures/letters/pass-rate/ if that folder
 *                               exists, otherwise every .txt and .pdf in
 *                               fixtures/letters/ (a PDF replaces a .txt with
 *                               the same name and goes through the extractor)
 *
 * Needs the checker service at CHECKER_URL. Loads ../.env (see package.json).
 * FIXTURE_DELAY_MS sets the pause between letters (default 15000), to stay
 * under per-minute provider limits.
 *
 * Output: a summary table on stdout and fixtures/results/<stamp>-<set>.json.
 * Both hold rule results and metadata only. Letter text, lines, check details
 * and key-fact values never go to the console or the file (R7.4).
 *
 * Exit codes: 0 when every letter finished (passed, flagged or blocked all
 * count), 1 when a letter hit a model or input error, 2 when the checker or
 * the model config is unavailable.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckerClient, CheckerConfigError, CheckerUnavailable, createCheckerClient } from "../src/checker-client";
import { classifyError, withRetryAfterOnce } from "../src/convert/handler";
import { letterLengthProblem } from "../src/convert/word-count";
import { extractPdfText } from "../src/extract/pdf";
import {
  type FixtureLetter,
  type LetterRecord,
  type LetterSet,
  type ModelRequestCounts,
  type RunReport,
  DEFAULT_SET_SIZE,
  PASS_RATE_DIR,
  computeTotals,
  errorRecord,
  exitCodeFor,
  fileStamp,
  recordFromResult,
  selectLetters,
  summaryTable,
} from "../src/fixtures/report";
import { type ModelConfig, type Role, createModelClient, loadModelConfig } from "../src/llm";
import { convert, modelFromClient } from "../src/pipeline";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const LETTERS_DIR = path.join(ROOT, "fixtures/letters");
const RESULTS_DIR = path.join(ROOT, "fixtures/results");
const CHECKER_START = "cd checker && uv run uvicorn http_app:app --app-dir src";
const DELAY_MS = Number(process.env.FIXTURE_DELAY_MS ?? 15_000);
/** spaCy takes a few seconds to load; wait this long for "starting" to become "ok". */
const CHECKER_START_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class SetupError extends Error {}

async function waitForChecker(checker: CheckerClient): Promise<void> {
  const deadline = Date.now() + CHECKER_START_WAIT_MS;
  for (;;) {
    try {
      const health = await checker.health();
      if (health.status === "ok") return;
    } catch (err) {
      if (err instanceof CheckerUnavailable) {
        throw new SetupError(`The checker service is not reachable at ${process.env.CHECKER_URL}. Start it with:\n  ${CHECKER_START}`);
      }
      throw err;
    }
    if (Date.now() > deadline) throw new SetupError("The checker service is still starting. Try again in a moment.");
    await sleep(1000);
  }
}

async function chooseLetters(set: LetterSet): Promise<{ dir: string; letters: FixtureLetter[] }> {
  if (set === "all") {
    const passRate = path.join(LETTERS_DIR, PASS_RATE_DIR);
    const isDir = await stat(passRate).then((s) => s.isDirectory(), () => false);
    if (isDir) return { dir: passRate, letters: selectLetters(await readdir(passRate), "all") };
  }
  return { dir: LETTERS_DIR, letters: selectLetters(await readdir(LETTERS_DIR), set) };
}

type LoadedLetter = { ok: true; text: string } | { ok: false; error: "pdf_no_text_layer" | "pdf_too_many_pages" | "pdf_unreadable" };

async function loadLetter(dir: string, letter: FixtureLetter): Promise<LoadedLetter> {
  const file = path.join(dir, letter.file);
  if (letter.source === "txt") return { ok: true, text: await readFile(file, "utf8") };
  const pdf = await extractPdfText(new Uint8Array(await readFile(file)));
  if (pdf.kind === "text") return { ok: true, text: pdf.text };
  return { ok: false, error: pdf.kind === "no_text_layer" ? "pdf_no_text_layer" : pdf.kind === "too_many_pages" ? "pdf_too_many_pages" : "pdf_unreadable" };
}

function chainNames(config: ModelConfig): Record<string, string[]> {
  return Object.fromEntries(
    (Object.keys(config.chains) as Role[]).map((role) => [role, config.chains[role].map((e) => `${e.provider}:${e.model}`)]),
  );
}

async function runLetter(
  dir: string,
  letter: FixtureLetter,
  checker: CheckerClient,
  config: ModelConfig,
): Promise<LetterRecord> {
  const started = performance.now();
  const requests: ModelRequestCounts = { total: 0, ok: 0, outcomes: {} };
  const meta = () => ({ ms: Math.round(performance.now() - started), requests });

  const loaded = await loadLetter(dir, letter);
  if (!loaded.ok) return errorRecord(letter, loaded.error, meta());
  const problem = letterLengthProblem(loaded.text);
  if (problem) return errorRecord(letter, problem === "empty" ? "empty" : "too_long", meta());

  const client = createModelClient({
    config,
    logger: (e) => {
      requests.total++;
      if (e.outcome === "ok") requests.ok++;
      requests.outcomes[e.outcome] = (requests.outcomes[e.outcome] ?? 0) + 1;
    },
  });
  const model = withRetryAfterOnce(modelFromClient(client), sleep);
  try {
    const result = await convert(loaded.text, {
      model,
      checker,
      logger: (e) => {
        if (e.msg !== "pipeline_attempt") return;
        const failed = e.results.filter((r) => !r.passed).map((r) => r.rule);
        console.log(
          `    try ${e.attempt}: ${failed.length ? `failed ${failed.join(", ")}` : "all passed"}` +
            `${e.judgeAvailable ? "" : " (judge unavailable)"}; ${e.ms} ms`,
        );
      },
    });
    return recordFromResult(letter, result, meta());
  } catch (err) {
    if (err instanceof CheckerUnavailable) throw err;
    const code = classifyError(err).error;
    const known = code === "providers_unavailable" || code === "model_output_invalid" ? code : "internal";
    return errorRecord(letter, known, { ...meta(), errorName: err instanceof Error ? err.name : undefined });
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--all");
  if (unknown.length) throw new SetupError(`Unknown option: ${unknown.join(" ")}. The only option is --all.`);
  const set: LetterSet = args.includes("--all") ? "all" : "default";

  let checker: CheckerClient;
  let config: ModelConfig;
  try {
    checker = createCheckerClient();
    config = loadModelConfig(process.env);
  } catch (err) {
    if (err instanceof CheckerConfigError) throw new SetupError(`${err.message}. Set CHECKER_URL in .env (for example http://localhost:8000).`);
    throw new SetupError(`Model config: ${(err as Error).message}`);
  }
  await waitForChecker(checker);

  const { dir, letters } = await chooseLetters(set);
  if (letters.length === 0) throw new SetupError(`No letters found in ${path.relative(ROOT, dir)}.`);
  const startedAt = new Date();
  console.log(`Fixture run: ${set} set, ${letters.length} letters from ${path.relative(ROOT, dir)}, APP_ENV=${config.appEnv}`);
  if (set === "default" && letters.length !== DEFAULT_SET_SIZE) {
    console.log(`  note: expected ${DEFAULT_SET_SIZE} invented letters, found ${letters.length}`);
  }

  const records: LetterRecord[] = [];
  for (const [i, letter] of letters.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    console.log(`\n[${i + 1}/${letters.length}] ${letter.file}`);
    const record = await runLetter(dir, letter, checker, config);
    records.push(record);
    console.log(
      `  ${record.status ?? `error: ${record.error}`}` +
        (record.attempts ? `, ${record.attempts} tries` : "") +
        `, ${record.requests.total} model requests, ${record.ms} ms`,
    );
  }

  const report: RunReport = {
    kind: "easy-read-fixture-run",
    version: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    set,
    lettersDir: path.relative(ROOT, dir),
    appEnv: config.appEnv,
    chains: chainNames(config),
    letters: records,
    totals: computeTotals(records),
  };
  await mkdir(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `${fileStamp(startedAt)}-${set}.json`);
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\n${summaryTable(records)}`);
  console.log(`\nResults: ${path.relative(ROOT, out)}`);
  return exitCodeFor(records);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    // Messages here come from this script and the config, never from letter text.
    if (err instanceof SetupError) {
      console.error(`fixtures: ${err.message}`);
    } else if (err instanceof CheckerUnavailable) {
      console.error(`fixtures: the checker service stopped answering (${err.name}). Start it with:\n  ${CHECKER_START}`);
    } else {
      console.error(`fixtures failed: ${err instanceof Error ? err.name : "unknown error"}`);
    }
    process.exit(2);
  },
);
