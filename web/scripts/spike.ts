/**
 * Day 1 spike (task 8). Measures, for the fixture letters:
 * - P1, P2 and P4 pass counts per rewrite candidate (scored by checker/scripts/score.py)
 * - tokens and time per rewrite request
 * - whether Groq's qwen/qwen3.8-27b accepts an image (one generated test image)
 * - which ARASAAC endpoint returns the full English catalogue
 * - pictogram coverage: does an ARASAAC search for each line's symbolQuery match?
 *
 * Run with `npm run spike` (loads ../.env). Optional flags:
 *   --set=invented|public|all  which fixture letters to run (default invented;
 *                         public means every .txt not starting with "invented-")
 *   --letter=<substring>  only letters whose file name contains it
 *   --model=<substring>   only candidates whose entry contains it
 *   --skip-vision  --skip-arasaac
 *
 * The console shows only counts, timings, tokens and provider outcomes. Letter
 * text, model output and key-fact values never go to the console (R7.4). Raw
 * output goes to web/.spike-output/ (gitignored) for inspection.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { z } from "zod";
import {
  type ChainEntry,
  type ChatRequest,
  type ChatResult,
  type ModelLogEvent,
  type Role,
  type Transport,
  PROVIDERS,
  ProviderChainError,
  ProviderRequestError,
  createModelClient,
  fetchTransport,
  loadModelConfig,
  parseChain,
} from "../src/llm";
import { loadPrompt } from "../src/llm/prompts";
import { parseJsonLoose } from "../src/llm/structured";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const LETTERS_DIR = path.join(ROOT, "fixtures/letters");
const CHECKER_DIR = path.join(ROOT, "checker");
const OUT_DIR = path.join(ROOT, "web/.spike-output");

/** Design "Model provider" rewrite chain, used when MODEL_REWRITE is unset. */
const DEFAULT_REWRITE = "bedrock:openai.gpt-oss-120b-1:0,groq:openai/gpt-oss-120b";
const VISION_ENTRY: ChainEntry = { provider: "groq", model: "qwen/qwen3.8-27b" };
const ARASAAC_API = "https://api.arasaac.org";
const CATALOGUE_CANDIDATES = [
  `${ARASAAC_API}/v1/pictograms/all/en`,
  `${ARASAAC_API}/api/pictograms/all/en`,
];
/** Pause between model calls, to stay under per-minute limits (Groq: 8,000 tokens a minute). */
const DELAY_MS = Number(process.env.SPIKE_DELAY_MS ?? 10_000);
const RATE_LIMIT_RETRIES = 1;
const REWRITE_MAX_TOKENS = 3000;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- checker CLI -------------------------------------------------------------

interface Sentence { id: string; text: string; start: number; end: number }
interface KeyFact { id: string; type: string; value: string; normalised: string; sentence_id: string }
interface CheckResult { rule: string; passed: boolean; line_ids: string[]; failed_fact_ids: string[]; details: string[] }

function runChecker<T>(command: "analyse" | "score", input: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "--quiet", "python", "scripts/score.py", command], {
      cwd: CHECKER_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`score.py ${command} exited ${code}: ${err.slice(0, 200)}`));
      try {
        resolve(JSON.parse(out) as T);
      } catch {
        reject(new Error(`score.py ${command} returned invalid JSON`));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

// --- prompt and output parsing -------------------------------------------------

const draftLines = z.object({
  lines: z
    .array(
      z.object({
        text: z.string().min(1),
        sourceSentenceId: z.string(),
        symbolQuery: z.string().default(""),
      }),
    )
    .min(1),
});
type DraftLine = z.infer<typeof draftLines>["lines"][number];

const SUBMIT_TOOL = {
  type: "function",
  function: {
    name: "submit_lines",
    description: "Submit the Easy Read lines for the letter, in order.",
    parameters: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "One short Easy Read sentence" },
              sourceSentenceId: { type: "string", description: "ID of the source sentence, e.g. s4" },
              symbolQuery: { type: "string", description: "1 or 2 common words for a picture, or empty" },
            },
            required: ["text", "sourceSentenceId", "symbolQuery"],
          },
        },
      },
      required: ["lines"],
    },
  },
};

/** Pull lines from a tool call, or from JSON in the message content. */
function parseLines(result: ChatResult): { lines: DraftLine[]; via: "tool" | "content" } | null {
  const calls = (result.message.tool_calls ?? []) as { function?: { arguments?: unknown } }[];
  for (const call of calls) {
    const a = call.function?.arguments;
    try {
      const parsed = draftLines.safeParse(typeof a === "string" ? JSON.parse(a) : a);
      if (parsed.success) return { lines: parsed.data.lines, via: "tool" };
    } catch {
      /* fall through */
    }
  }
  if (result.message.content) {
    try {
      const parsed = draftLines.safeParse(parseJsonLoose(result.message.content));
      if (parsed.success) return { lines: parsed.data.lines, via: "content" };
    } catch {
      /* invalid */
    }
  }
  return null;
}

// --- model calls ---------------------------------------------------------------

interface RequestRecord {
  ok: boolean;
  outcome: string;
  status?: number;
  ms: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  finishReason?: string | null;
  mode: "tools" | "content";
  parsed?: "tool" | "content" | "invalid";
  error?: string;
}

/** Wraps the transport to keep the provider's error code for 4xx replies. No request content is kept. */
function capturingTransport(sink: { lastError?: string }): Transport {
  return async (req) => {
    const res = await fetchTransport(req);
    if (res.status >= 400) {
      const e = (res.json as { error?: { code?: unknown; type?: unknown; message?: unknown } } | null)?.error;
      const msg = typeof e?.message === "string" ? e.message.slice(0, 160) : "";
      sink.lastError = [e?.code, e?.type, msg].filter(Boolean).join(" | ") || `HTTP ${res.status}`;
    } else {
      sink.lastError = undefined;
    }
    return res;
  };
}

function makeClient(role: Role, entry: ChainEntry, sink: { lastError?: string }, events: ModelLogEvent[]) {
  const base = loadModelConfig(process.env);
  return createModelClient({
    config: { ...base, chains: { ...base.chains, [role]: [entry] } },
    transport: capturingTransport(sink),
    timeoutMs: 120_000,
    logger: (e) => events.push(e),
  });
}

async function callOnce(
  role: Role,
  entry: ChainEntry,
  request: ChatRequest,
  mode: "tools" | "content",
): Promise<{ record: RequestRecord; result?: ChatResult }> {
  const sink: { lastError?: string } = {};
  const events: ModelLogEvent[] = [];
  const client = makeClient(role, entry, sink, events);
  for (let i = 0; ; i++) {
    const t0 = performance.now();
    try {
      const result = await client.chat(role, request);
      const u = result.usage as
        | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number;
            completion_tokens_details?: { reasoning_tokens?: number } }
        | undefined;
      return {
        result,
        record: {
          ok: true,
          outcome: "ok",
          ms: Math.round(performance.now() - t0),
          promptTokens: u?.prompt_tokens,
          completionTokens: u?.completion_tokens,
          totalTokens: u?.total_tokens,
          reasoningTokens: u?.completion_tokens_details?.reasoning_tokens,
          finishReason: result.finishReason,
          mode,
        },
      };
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      if (err instanceof ProviderChainError) {
        const last = err.attempts.at(-1);
        if (last?.outcome === "rate_limited" && i < RATE_LIMIT_RETRIES) {
          const wait = Math.min(Math.max(err.retryAfterMs ?? 0, 20_000), 30_000);
          console.log(`    rate limited (429), waiting ${Math.round(wait / 1000)}s`);
          await sleep(wait);
          continue;
        }
        return {
          record: { ok: false, outcome: last?.outcome ?? "chain_error", status: last?.status, ms, mode, error: sink.lastError },
        };
      }
      if (err instanceof ProviderRequestError) {
        return {
          record: { ok: false, outcome: err.attempt.outcome, status: err.attempt.status, ms, mode, error: sink.lastError },
        };
      }
      return { record: { ok: false, outcome: "exception", ms, mode, error: (err as Error).name } };
    }
  }
}

/**
 * One rewrite. Tool call first. If the provider rejects tools (4xx) or the reply
 * has no valid lines, retry once asking for JSON content (design "Error Handling":
 * invalid JSON gets one retry).
 */
async function rewrite(entry: ChainEntry, system: string, user: string) {
  const requests: RequestRecord[] = [];
  const base: ChatRequest = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    maxTokens: REWRITE_MAX_TOKENS,
  };
  const first = await callOnce("rewrite", entry, {
    ...base,
    tools: [SUBMIT_TOOL],
    tool_choice: { type: "function", function: { name: "submit_lines" } },
  }, "tools");
  requests.push(first.record);
  if (first.result) {
    const parsed = parseLines(first.result);
    first.record.parsed = parsed?.via ?? "invalid";
    if (parsed) return { requests, lines: parsed.lines, raw: first.result.message };
  }
  // Retry only for a rejected tool request or an unparseable reply, not for missing keys or exhausted limits.
  const retryable = first.result || first.record.outcome === "client_error";
  if (!retryable) return { requests, lines: null, raw: null };
  await sleep(DELAY_MS);
  const second = await callOnce("rewrite", entry, base, "content");
  requests.push(second.record);
  if (second.result) {
    const parsed = parseLines(second.result);
    second.record.parsed = parsed?.via ?? "invalid";
    if (parsed) return { requests, lines: parsed.lines, raw: second.result.message };
    return { requests, lines: null, raw: second.result.message };
  }
  return { requests, lines: null, raw: first.result?.message ?? null };
}

// --- vision check ---------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A solid-colour RGB PNG. No letter content. */
function solidPng(size: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => rgb[i % 3])]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function visionCheck() {
  const png = solidPng(64, [220, 20, 20]);
  const { record, result } = await callOnce("vision", VISION_ENTRY, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What colour fills this image? Reply with one word." },
          { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
        ],
      },
    ],
    maxTokens: 300,
  }, "content");
  // The answer is about a generated red square, so it is safe to record.
  const answer = (result?.message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim().slice(0, 40);
  return { entry: `${VISION_ENTRY.provider}:${VISION_ENTRY.model}`, ...record, answer, saidRed: /red/i.test(answer) };
}

// --- ARASAAC --------------------------------------------------------------------

async function catalogueCheck() {
  const out = [];
  for (const url of CATALOGUE_CANDIDATES) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      const text = await res.text();
      let count: number | undefined;
      let fields: string[] | undefined;
      let flagged: { violence: number; sex: number } | undefined;
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          count = data.length;
          fields = data[0] ? Object.keys(data[0]).sort() : [];
          flagged = {
            violence: data.filter((p: { violence?: boolean }) => p.violence).length,
            sex: data.filter((p: { sex?: boolean }) => p.sex).length,
          };
        }
      } catch {
        /* not JSON */
      }
      out.push({ url, status: res.status, bytes: text.length, count, fields, flagged, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      out.push({ url, status: 0, error: (err as Error).name, ms: Math.round(performance.now() - t0) });
    }
  }
  return out;
}

const searchCache = new Map<string, boolean | null>();

/** true: at least 1 pictogram; false: no match; null: request failed. */
async function arasaacHasMatch(query: string): Promise<boolean | null> {
  const q = query.trim().toLowerCase();
  if (searchCache.has(q)) return searchCache.get(q)!;
  let found: boolean | null = null;
  try {
    const res = await fetch(`${ARASAAC_API}/v1/pictograms/en/search/${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) found = false;
    else if (res.ok) {
      const data = (await res.json()) as unknown;
      found = Array.isArray(data) && data.length > 0;
    }
  } catch {
    found = null;
  }
  searchCache.set(q, found);
  await sleep(150);
  return found;
}

// --- main -----------------------------------------------------------------------

interface LetterRun {
  letter: string;
  candidate: string;
  requests: RequestRecord[];
  lineCount?: number;
  badSourceIds?: number;
  results?: { rule: string; passed: boolean; failingLines: number; failedFacts: number; details: string[] }[];
  keyFactCount?: number;
  coverage?: { withQuery: number; matched: number; noMatch: number; errors: number };
  error?: string;
}

function keyPresence() {
  return Object.fromEntries(
    (Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]).map((p) => [PROVIDERS[p].keyEnv, Boolean(process.env[PROVIDERS[p].keyEnv])]),
  );
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(OUT_DIR, stamp);
  await mkdir(runDir, { recursive: true });

  const usingDefault = !process.env.MODEL_REWRITE;
  let candidates = parseChain(process.env.MODEL_REWRITE || DEFAULT_REWRITE);
  const modelFilter = option("model");
  if (modelFilter) candidates = candidates.filter((c) => `${c.provider}:${c.model}`.includes(modelFilter));

  const keys = keyPresence();
  console.log(`APP_ENV=${process.env.APP_ENV ?? "development"}`);
  console.log(
    usingDefault
      ? "MODEL_REWRITE is unset: using the default candidate list from design 'Model provider'."
      : "Rewrite candidates come from MODEL_REWRITE.",
  );
  for (const c of candidates) {
    console.log(`  ${c.provider}:${c.model}  key present: ${keys[PROVIDERS[c.provider].keyEnv]}`);
  }

  const set = option("set") ?? "invented";
  if (!["invented", "public", "all"].includes(set)) throw new Error(`--set must be invented, public or all (got ${set})`);
  let letters = (await readdir(LETTERS_DIR))
    .filter((f) => f.endsWith(".txt"))
    .filter((f) => set === "all" || (set === "invented") === f.startsWith("invented-"))
    .sort();
  console.log(`Letter set: ${set} (${letters.length} letters)`);
  const letterFilter = option("letter");
  if (letterFilter) letters = letters.filter((f) => f.includes(letterFilter));
  const prompt = await loadPrompt("rewrite", path.join(ROOT, "prompts"));

  const runs: LetterRun[] = [];
  let firstCall = true;
  for (const letter of letters) {
    const original = await readFile(path.join(LETTERS_DIR, letter), "utf8");
    const analysis = await runChecker<{ sentences: Sentence[]; key_facts: KeyFact[] }>("analyse", { original });
    const sentenceIds = new Set(analysis.sentences.map((s) => s.id));
    const user = prompt.user
      .replace("{{sentences}}", analysis.sentences.map((s) => `${s.id}: ${s.text.replace(/\s+/g, " ")}`).join("\n"))
      .replace("{{key_facts}}", analysis.key_facts.map((f) => `- ${f.type}: ${f.value.replace(/\s+/g, " ")}`).join("\n"));
    console.log(`\n${letter}: ${analysis.sentences.length} sentences, ${analysis.key_facts.length} key facts`);

    for (const entry of candidates) {
      const candidate = `${entry.provider}:${entry.model}`;
      const run: LetterRun = { letter, candidate, requests: [] };
      runs.push(run);
      if (!keys[PROVIDERS[entry.provider].keyEnv]) {
        run.error = "missing_key";
        run.requests.push({ ok: false, outcome: "missing_key", ms: 0, mode: "tools" });
        console.log(`  ${candidate}: missing_key (${PROVIDERS[entry.provider].keyEnv} not set), skipped`);
        continue;
      }
      if (!firstCall) await sleep(DELAY_MS);
      firstCall = false;

      const r = await rewrite(entry, prompt.system, user);
      run.requests = r.requests;
      await writeFile(
        path.join(runDir, `${letter.replace(/\.txt$/, "")}__${candidate.replace(/[^\w.-]+/g, "_")}.json`),
        JSON.stringify({ letter, candidate, requests: r.requests, lines: r.lines, raw: r.raw }, null, 2),
      );
      const req = r.requests.map((q) => `${q.mode}:${q.outcome}${q.status ? ` ${q.status}` : ""}${q.parsed ? `/${q.parsed}` : ""}`).join(", ");
      if (!r.lines) {
        const lastReq = r.requests.at(-1);
        run.error = !lastReq
          ? "no_lines"
          : lastReq.ok
            ? lastReq.finishReason === "length"
              ? `truncated_at_max_tokens (${REWRITE_MAX_TOKENS})`
              : "invalid_json"
            : (lastReq.error ?? lastReq.outcome);
        console.log(`  ${candidate}: no valid lines [${req}]${run.error ? ` (${run.error})` : ""}`);
        continue;
      }

      const lines = r.lines.map((l, i) => ({
        id: `L${i + 1}`,
        text: l.text,
        source_sentence_id: l.sourceSentenceId,
        symbol_id: null,
      }));
      run.lineCount = lines.length;
      run.badSourceIds = r.lines.filter((l) => !sentenceIds.has(l.sourceSentenceId)).length;
      const scored = await runChecker<{ key_fact_count: number; results: CheckResult[] }>("score", { original, lines });
      run.keyFactCount = scored.key_fact_count;
      // details hold fact IDs, types and counts only, never values.
      run.results = scored.results.map((c) => ({
        rule: c.rule,
        passed: c.passed,
        failingLines: c.passed ? 0 : c.line_ids.length,
        failedFacts: c.failed_fact_ids.length,
        details: c.rule === "P1" ? c.details : [],
      }));

      if (!flag("skip-arasaac")) {
        const cov = { withQuery: 0, matched: 0, noMatch: 0, errors: 0 };
        for (const l of r.lines) {
          if (!l.symbolQuery.trim()) continue;
          cov.withQuery++;
          const m = await arasaacHasMatch(l.symbolQuery);
          if (m === true) cov.matched++;
          else if (m === false) cov.noMatch++;
          else cov.errors++;
        }
        run.coverage = cov;
      }

      const last = r.requests.at(-1)!;
      const verdicts = run.results.map((c) => `${c.rule} ${c.passed ? "pass" : `FAIL(${c.failingLines} lines${c.rule === "P1" ? `, ${c.failedFacts} facts` : ""})`}`).join(", ");
      console.log(
        `  ${candidate}: ${lines.length} lines; ${verdicts}; tokens ${last.promptTokens ?? "?"}+${last.completionTokens ?? "?"}=${last.totalTokens ?? "?"}; ${last.ms} ms [${req}]` +
          (run.coverage ? `; pictograms ${run.coverage.matched}/${lines.length}` : ""),
      );
    }
  }

  const vision = flag("skip-vision")
    ? null
    : keys[PROVIDERS[VISION_ENTRY.provider].keyEnv]
      ? (await sleep(DELAY_MS), await visionCheck())
      : { entry: `${VISION_ENTRY.provider}:${VISION_ENTRY.model}`, ok: false, outcome: "missing_key" };
  if (vision) console.log(`\nVision check: ${JSON.stringify(vision)}`);

  const catalogue = flag("skip-arasaac") ? null : await catalogueCheck();
  if (catalogue) console.log(`\nARASAAC catalogue: ${JSON.stringify(catalogue)}`);

  // Aggregate per candidate.
  const summary = candidates.map((entry) => {
    const candidate = `${entry.provider}:${entry.model}`;
    const mine = runs.filter((r) => r.candidate === candidate);
    const scored = mine.filter((r) => r.results);
    const reqs = mine.flatMap((r) => r.requests).filter((q) => q.ok);
    const pass = (rule: string) => scored.filter((r) => r.results!.find((c) => c.rule === rule)?.passed).length;
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const nums = (k: keyof RequestRecord) => reqs.map((q) => q[k]).filter((v): v is number => typeof v === "number");
    const cov = scored.reduce(
      (a, r) => ({
        lines: a.lines + (r.lineCount ?? 0),
        withQuery: a.withQuery + (r.coverage?.withQuery ?? 0),
        matched: a.matched + (r.coverage?.matched ?? 0),
        errors: a.errors + (r.coverage?.errors ?? 0),
      }),
      { lines: 0, withQuery: 0, matched: 0, errors: 0 },
    );
    return {
      candidate,
      letters: mine.length,
      scored: scored.length,
      P1: pass("P1"),
      P2: pass("P2"),
      P4: pass("P4"),
      allThree: scored.filter((r) => r.results!.every((c) => c.passed)).length,
      requests: mine.flatMap((r) => r.requests).length,
      okRequests: reqs.length,
      avgPromptTokens: avg(nums("promptTokens")),
      avgCompletionTokens: avg(nums("completionTokens")),
      avgTotalTokens: avg(nums("totalTokens")),
      maxTotalTokens: nums("totalTokens").length ? Math.max(...nums("totalTokens")) : null,
      avgReasoningTokens: avg(nums("reasoningTokens")),
      avgMs: avg(nums("ms")),
      truncatedRequests: reqs.filter((q) => q.finishReason === "length").length,
      coverage: cov,
      errors: mine.filter((r) => r.error).map((r) => `${r.letter}: ${r.error}`),
    };
  });

  const report = { stamp, usingDefaultCandidates: usingDefault, keys, summary, runs, vision, catalogue };
  await writeFile(path.join(runDir, "summary.json"), JSON.stringify(report, null, 2));
  console.log("\nSummary per candidate:");
  console.table(
    summary.map((s) => ({
      candidate: s.candidate,
      scored: `${s.scored}/${s.letters}`,
      P1: s.P1, P2: s.P2, P4: s.P4, all3: s.allThree,
      avgTokens: s.avgTotalTokens, maxTokens: s.maxTotalTokens, avgMs: s.avgMs,
      truncated: `${s.truncatedRequests}/${s.okRequests}`,
      pictograms: `${s.coverage.matched}/${s.coverage.lines}`,
    })),
  );
  console.log(`\nRaw output and summary.json: ${path.relative(ROOT, runDir)} (gitignored)`);
}

main().catch((err) => {
  // Error names and messages here come from this script and the checker CLI, not from letter text.
  console.error(`spike failed: ${(err as Error).message}`);
  process.exit(1);
});
