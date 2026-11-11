/**
 * Records the sample letters for the input screen (task 29, design
 * "Protecting the live quota").
 *
 *   npm run record-samples
 *
 * Runs each public sample letter in fixtures/letters/ through the full
 * pipeline, one at a time, and writes `web/data/samples/<id>.json` with the
 * `ConversionResult`, the time and the models that answered. Then rewrites
 * `web/data/samples/index.ts`, which imports every sample file there.
 *
 * - Only "passed" or "flagged" results are saved. A blocked result or an error
 *   is retried once after a pause; if it fails again it is reported and skipped,
 *   and any earlier recording of that letter is kept.
 * - Only the public sample letters are recorded, never the invented ones and
 *   never user letters. Storing their text is allowed because they are public
 *   templates (see web/data/samples/README.md and safety.md).
 *
 * Needs the checker service at CHECKER_URL. Loads ../.env (see package.json).
 * SAMPLE_DELAY_MS sets the pause between letters and before a retry (default
 * 60000), to stay under per-minute provider limits.
 *
 * Console output holds status, tries, request counts and model names only.
 *
 * Exit codes: 0 when every letter was saved, 1 when any was skipped, 2 when
 * the checker or the model config is unavailable.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckerClient, CheckerConfigError, CheckerUnavailable, createCheckerClient } from "../src/checker-client";
import { classifyError, withRetryAfterOnce } from "../src/convert/handler";
import { letterLengthProblem } from "../src/convert/word-count";
import { extractPdfText } from "../src/extract/pdf";
import { type ModelConfig, createModelClient, loadModelConfig } from "../src/llm";
import { convert, modelFromClient } from "../src/pipeline";
import { type SampleFile, modelsOf, sampleFileSchema } from "../src/samples/sample";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const LETTERS_DIR = path.join(ROOT, "fixtures/letters");
const SAMPLES_DIR = path.join(ROOT, "web/data/samples");
const CHECKER_START = "cd checker && uv run uvicorn http_app:app --app-dir src";
const DELAY_MS = Number(process.env.SAMPLE_DELAY_MS ?? 60_000);
const CHECKER_START_WAIT_MS = 30_000;

/** The public sample letters (fixtures/letters/README.md). A PDF goes through the extractor. */
const PUBLIC_SAMPLES: readonly { id: string; file: string; label: string }[] = [
  {
    id: "council-tax-final-notice-east-cambridgeshire",
    file: "council-tax-final-notice-east-cambridgeshire.pdf",
    label: "Council Tax final notice (East Cambridgeshire)",
  },
  {
    id: "manchester-missed-council-tax-payment",
    file: "manchester-missed-council-tax-payment.pdf",
    label: "Missed Council Tax payment (Manchester)",
  },
  {
    id: "planning-appeal-notification-letter",
    file: "planning-appeal-notification-letter.txt",
    label: "Planning appeal notice (Planning Inspectorate)",
  },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class SetupError extends Error {}

async function waitForChecker(checker: CheckerClient): Promise<void> {
  const deadline = Date.now() + CHECKER_START_WAIT_MS;
  for (;;) {
    try {
      if ((await checker.health()).status === "ok") return;
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

async function loadText(file: string): Promise<string> {
  const full = path.join(LETTERS_DIR, file);
  if (file.endsWith(".txt")) return readFile(full, "utf8");
  const pdf = await extractPdfText(new Uint8Array(await readFile(full)));
  if (pdf.kind !== "text") throw new SetupError(`${file}: PDF extraction failed (${pdf.kind}).`);
  return pdf.text;
}

type Attempt = { ok: true; sample: SampleFile } | { ok: false; reason: string };

async function recordOnce(
  entry: (typeof PUBLIC_SAMPLES)[number],
  text: string,
  checker: CheckerClient,
  config: ModelConfig,
): Promise<Attempt> {
  const requests = { total: 0, ok: 0 };
  const client = createModelClient({
    config,
    logger: (e) => {
      requests.total++;
      if (e.outcome === "ok") requests.ok++;
    },
  });
  const model = withRetryAfterOnce(modelFromClient(client), sleep);
  const started = performance.now();
  try {
    const recordedAt = new Date().toISOString();
    const result = await convert(text, { model, checker });
    const ms = Math.round(performance.now() - started);
    console.log(`  ${result.status}, ${result.attempts} tries, ${requests.ok}/${requests.total} model requests ok, ${ms} ms`);
    if (result.status === "blocked") return { ok: false, reason: "blocked (P1 failed)" };
    const models = modelsOf(result.models);
    if (models.length === 0) return { ok: false, reason: "no model answered" };
    const sample = sampleFileSchema.parse({
      id: entry.id,
      label: entry.label,
      source: entry.file,
      recordedAt,
      models,
      result,
    });
    console.log(`  models: ${models.join(", ")}`);
    return { ok: true, sample };
  } catch (err) {
    if (err instanceof CheckerUnavailable) throw err;
    const code = classifyError(err).error;
    console.log(`  error: ${code} (${err instanceof Error ? err.name : "unknown"}), ${requests.ok}/${requests.total} model requests ok`);
    return { ok: false, reason: `error ${code}` };
  }
}

/** `index.ts` imports every sample JSON file, so the app bundles them statically on the server. */
async function writeIndex(): Promise<string[]> {
  const files = (await readdir(SAMPLES_DIR)).filter((f) => f.endsWith(".json")).sort();
  const names = files.map((f, i) => ({ file: f, name: `sample${i}` }));
  const source = [
    "// Written by `npm run record-samples`. Don't edit by hand.",
    "// Server-only: imported by src/samples/catalog.ts, never by client code.",
    ...names.map((n) => `import ${n.name} from "./${n.file}";`),
    "",
    `export const SAMPLE_FILES: unknown[] = [${names.map((n) => n.name).join(", ")}];`,
    "",
  ].join("\n");
  await writeFile(path.join(SAMPLES_DIR, "index.ts"), source);
  return files;
}

async function main(): Promise<number> {
  if (process.argv.length > 2) throw new SetupError("record-samples takes no options.");
  let checker: CheckerClient;
  let config: ModelConfig;
  try {
    checker = createCheckerClient();
    config = loadModelConfig(process.env);
  } catch (err) {
    if (err instanceof CheckerConfigError) throw new SetupError(`${err.message}. Set CHECKER_URL in .env.`);
    throw new SetupError(`Model config: ${(err as Error).message}`);
  }
  await waitForChecker(checker);
  await mkdir(SAMPLES_DIR, { recursive: true });
  console.log(`Recording ${PUBLIC_SAMPLES.length} sample letters, APP_ENV=${config.appEnv}, pause ${DELAY_MS} ms`);

  const skipped: string[] = [];
  for (const [i, entry] of PUBLIC_SAMPLES.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    console.log(`\n[${i + 1}/${PUBLIC_SAMPLES.length}] ${entry.file}`);
    const text = await loadText(entry.file);
    const problem = letterLengthProblem(text);
    if (problem) {
      console.log(`  skipped: letter is ${problem}`);
      skipped.push(`${entry.id} (${problem})`);
      continue;
    }
    let attempt = await recordOnce(entry, text, checker, config);
    if (!attempt.ok) {
      console.log(`  ${attempt.reason}; retrying once in ${DELAY_MS} ms`);
      await sleep(DELAY_MS);
      attempt = await recordOnce(entry, text, checker, config);
    }
    if (!attempt.ok) {
      console.log(`  skipped: ${attempt.reason}`);
      skipped.push(`${entry.id} (${attempt.reason})`);
      continue;
    }
    await writeFile(path.join(SAMPLES_DIR, `${entry.id}.json`), `${JSON.stringify(attempt.sample, null, 2)}\n`);
    console.log(`  saved web/data/samples/${entry.id}.json`);
  }

  const files = await writeIndex();
  console.log(`\nSamples in web/data/samples: ${files.length ? files.join(", ") : "none"}`);
  if (skipped.length) console.log(`Skipped: ${skipped.join("; ")}`);
  return skipped.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof SetupError) console.error(`record-samples: ${err.message}`);
    else if (err instanceof CheckerUnavailable) console.error(`record-samples: the checker service stopped answering (${err.name}).`);
    else console.error(`record-samples failed: ${err instanceof Error ? err.name : "unknown error"}`);
    process.exit(2);
  },
);
