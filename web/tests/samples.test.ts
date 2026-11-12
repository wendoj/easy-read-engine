/**
 * Recorded sample letters (task 29, R3.1, design "Protecting the live quota").
 *
 * - Every file in web/data/samples/ matches the sample schema, and index.ts imports all of them.
 * - Loading a sample re-runs P1 to P8 through the checker and makes no model call.
 * - The recorded label shows the date and the model.
 *
 * The sample letter below is invented for this test and isn't in web/data/samples/.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_FILES } from "@/data/samples";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import type { CheckResult, KeyFact, Line, Sentence } from "@/src/checker-client/schemas";
import { RULES } from "@/src/pipeline/decide";
import type { ConversionResult, Rule } from "@/src/pipeline/types";
import { createSampleCatalog } from "@/src/samples/catalog";
import { type SampleHandlerDeps, type SampleRouteChecker, handleSample } from "@/src/samples/handler";
import { type SampleFile, formatRecordedDate, modelsOf, recordedLabel, sampleFileSchema } from "@/src/samples/sample";
import { loadSample } from "@/src/ui/api";

const SAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/samples");

// --- an invented sample -------------------------------------------------------

const ORIGINAL = "The council sent this letter on 3 March 2026. You must pay £45 by 1 April 2026.";
const S1 = "The council sent this letter on 3 March 2026.";
const S2 = "You must pay £45 by 1 April 2026.";

const SENTENCES: Sentence[] = [
  { id: "s1", text: S1, start: 0, end: S1.length },
  { id: "s2", text: S2, start: S1.length + 1, end: ORIGINAL.length },
];

const KEY_FACTS: KeyFact[] = [
  { id: "f1", type: "money", value: "£45", normalised: "45.00", start: 59, end: 62, sentence_id: "s2" },
];

const LINES: Line[] = [
  { id: "l1", text: S1, source_sentence_id: "s1", symbol_id: null },
  { id: "l2", text: S2, source_sentence_id: "s2", symbol_id: "1234" },
];

function pass(rule: Rule): CheckResult {
  return { rule, passed: true, line_ids: [], failed_fact_ids: [], details: [] };
}

function fail(rule: Rule, lineIds: string[], factIds: string[] = []): CheckResult {
  return { rule, passed: false, line_ids: lineIds, failed_fact_ids: factIds, details: lineIds.map((id) => `${id} failed`) };
}

function recordedResult(overrides: Partial<ConversionResult> = {}): ConversionResult {
  return {
    status: "passed",
    original: { text: ORIGINAL, sentences: SENTENCES },
    keyFacts: KEY_FACTS,
    lines: LINES,
    checks: RULES.map(pass),
    attempts: 1,
    notice: "This is a simplified version of your letter. The original letter is the official one.",
    judgeAvailable: true,
    models: [
      { task: "rewrite", attempt: 1, provider: "groq", model: "openai/gpt-oss-120b" },
      { task: "judge", attempt: 1, provider: "groq", model: "qwen/qwen3.8-27b" },
    ],
    actionSynonyms: [],
    lineFacts: [],
    ...overrides,
  };
}

function sampleFile(result: ConversionResult = recordedResult()): SampleFile {
  return {
    id: "invented-test-letter",
    label: "Invented test letter",
    source: "invented-test-letter.txt",
    recordedAt: "2026-05-12T09:30:00.000Z",
    models: modelsOf(result.models),
    result,
  };
}

/** A checker that answers from fixed data and records what it was asked. */
function fakeChecker(options: { checks?: CheckResult[]; health?: "ok" | "starting"; down?: boolean } = {}) {
  const calls = { analyse: [] as string[], check: [] as { lines: Line[]; key_facts: KeyFact[] }[], lineFacts: 0 };
  const checker: SampleRouteChecker = {
    async health() {
      if (options.down) throw new CheckerUnavailable("/health", "network");
      return { status: options.health ?? "ok" };
    },
    async analyse(original) {
      calls.analyse.push(original);
      return { sentences: SENTENCES, key_facts: KEY_FACTS };
    },
    async check(request) {
      calls.check.push({ lines: request.lines, key_facts: request.key_facts });
      return options.checks ?? RULES.slice(0, 8).map(pass);
    },
    async lineFacts() {
      calls.lineFacts++;
      return [{ line_id: "l2", fact_id: "f1", start: 13, end: 16 }];
    },
    async actionSynonyms() {
      return [{ word: "settle", counts_as: "pay" }];
    },
  };
  return { checker, calls };
}

function deps(checker: SampleRouteChecker, sample: SampleFile = sampleFile()): SampleHandlerDeps {
  return { getChecker: () => checker, catalog: createSampleCatalog([sample]), logger: () => {} };
}

function post(id: unknown): Request {
  return new Request("http://localhost/api/sample", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

/** Fails the test if anything reaches the network, which is how a model call would go out. */
function spyOnNetwork() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("unexpected network call");
  });
}

afterEach(() => vi.restoreAllMocks());

// --- recorded files -----------------------------------------------------------

describe("web/data/samples", () => {
  it("every sample file matches the schema and its file name", async () => {
    const files = (await readdir(SAMPLES_DIR)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const parsed = sampleFileSchema.safeParse(JSON.parse(await readFile(path.join(SAMPLES_DIR, file), "utf8")));
      expect(parsed.success, `${file}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
      if (parsed.success) {
        expect(`${parsed.data.id}.json`).toBe(file);
        expect(parsed.data.models.length).toBeGreaterThan(0);
        expect(["passed", "flagged"]).toContain(parsed.data.result.status);
      }
    }
  });

  it("index.ts imports every sample file, and the catalog accepts them", async () => {
    const files = (await readdir(SAMPLES_DIR)).filter((f) => f.endsWith(".json")).sort();
    const catalog = createSampleCatalog(SAMPLE_FILES);
    expect(catalog.list().map((s) => `${s.id}.json`).sort()).toEqual(files);
  });

  it("the sample list sent to the page holds no letter text or lines", () => {
    const [info] = createSampleCatalog([sampleFile()]).list();
    expect(Object.keys(info).sort()).toEqual(["id", "label", "models", "recordedAt"]);
  });

  it("rejects a blocked recording", () => {
    const blocked = sampleFile(recordedResult({ status: "blocked", lines: [] }));
    expect(sampleFileSchema.safeParse(blocked).success).toBe(false);
  });
});

// --- loading a sample ---------------------------------------------------------

describe("POST /api/sample", () => {
  it("needs no judge access cookie, even with ACCESS_KEY set in production", async () => {
    vi.stubEnv("ACCESS_KEY", "sample-test-key");
    vi.stubEnv("APP_ENV", "production");
    try {
      const { checker } = fakeChecker();
      const response = await handleSample(post("invented-test-letter"), deps(checker));
      expect(response.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("re-runs P1 to P8 on the recorded lines with no model call", async () => {
    const network = spyOnNetwork();
    const { checker, calls } = fakeChecker();
    const response = await handleSample(post("invented-test-letter"), deps(checker));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(network).not.toHaveBeenCalled();
    expect(calls.analyse).toEqual([ORIGINAL]);
    expect(calls.check).toHaveLength(1);
    expect(calls.check[0].lines).toEqual(LINES);
    expect(calls.check[0].key_facts).toEqual(KEY_FACTS);

    expect(body.judgeRecorded).toBe(true);
    expect(body.sample).toEqual({
      id: "invented-test-letter",
      label: "Invented test letter",
      recordedAt: "2026-05-12T09:30:00.000Z",
      models: ["groq:openai/gpt-oss-120b", "groq:qwen/qwen3.8-27b"],
    });
    expect(body.result.status).toBe("passed");
    expect(body.result.lines).toEqual(LINES);
    expect(body.result.checks.map((c: CheckResult) => c.rule)).toEqual(RULES);
    expect(body.result.lineFacts).toEqual([{ line_id: "l2", fact_id: "f1", start: 13, end: 16 }]);
    expect(body.result.actionSynonyms).toEqual([{ word: "settle", counts_as: "pay" }]);
  });

  it("shows the current P1 to P8 results, not the recorded ones, and keeps recorded P9 and P10", async () => {
    spyOnNetwork();
    const recordedChecks = RULES.map((r) => (r === "P10" ? fail("P10", ["l1"]) : pass(r)));
    const sample = sampleFile(recordedResult({ status: "flagged", checks: recordedChecks }));
    const nowChecks = RULES.slice(0, 8).map((r) => (r === "P2" ? fail("P2", ["l2"]) : pass(r)));
    const { checker } = fakeChecker({ checks: nowChecks });
    const body = await (await handleSample(post(sample.id), deps(checker, sample))).json();

    const byRule = new Map<Rule, CheckResult>(body.result.checks.map((c: CheckResult) => [c.rule, c]));
    expect(byRule.get("P2")).toMatchObject({ passed: false, line_ids: ["l2"] });
    expect(byRule.get("P10")).toMatchObject({ passed: false, line_ids: ["l1"] });
    expect(byRule.get("P9")?.passed).toBe(true);
    expect(body.result.status).toBe("flagged");
  });

  it("blocks with no lines when P1 fails on the re-check", async () => {
    spyOnNetwork();
    const nowChecks = RULES.slice(0, 8).map((r) => (r === "P1" ? fail("P1", [], ["f1"]) : pass(r)));
    const { checker, calls } = fakeChecker({ checks: nowChecks });
    const body = await (await handleSample(post("invented-test-letter"), deps(checker))).json();
    expect(body.result.status).toBe("blocked");
    expect(body.result.lines).toEqual([]);
    expect(body.result.lineFacts).toEqual([]);
    expect(calls.lineFacts).toBe(0);
  });

  it("returns 503 when the checker is down or starting, so unchecked output is never shown", async () => {
    for (const options of [{ down: true }, { health: "starting" as const }]) {
      const { checker, calls } = fakeChecker(options);
      const response = await handleSample(post("invented-test-letter"), deps(checker));
      expect(response.status).toBe(503);
      expect(calls.check).toHaveLength(0);
    }
  });

  it("returns 404 for an unknown sample and 400 for a bad body", async () => {
    const { checker } = fakeChecker();
    expect((await handleSample(post("no-such-letter"), deps(checker))).status).toBe(404);
    expect((await handleSample(post("../etc/passwd"), deps(checker))).status).toBe(400);
    const bad = new Request("http://localhost/api/sample", { method: "POST", body: "not json" });
    expect((await handleSample(bad, deps(checker))).status).toBe(400);
  });

  it("returns 500 sample_outdated when a recorded line's sentence no longer exists", async () => {
    const sample = sampleFile(
      recordedResult({ lines: [{ id: "l1", text: S1, source_sentence_id: "s9", symbol_id: null }] }),
    );
    const { checker } = fakeChecker();
    const response = await handleSample(post(sample.id), deps(checker, sample));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("sample_outdated");
  });

  it("loadSample parses the route's answer", async () => {
    const { checker } = fakeChecker();
    const d = deps(checker);
    const fetchThroughHandler = (async (url: string, init: RequestInit) =>
      handleSample(new Request(`http://localhost${url}`, init), d)) as unknown as typeof fetch;
    const outcome = await loadSample("invented-test-letter", { fetch: fetchThroughHandler });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.sample.models).toEqual(["groq:openai/gpt-oss-120b", "groq:qwen/qwen3.8-27b"]);
      expect(outcome.result.lines).toEqual(LINES);
    }
  });
});

// --- label --------------------------------------------------------------------

describe("recorded label", () => {
  it("shows the date and the model", () => {
    expect(recordedLabel({ recordedAt: "2026-05-12T09:30:00.000Z", models: ["groq:openai/gpt-oss-120b"] })).toBe(
      "Recorded on 12 May 2026 with groq:openai/gpt-oss-120b",
    );
    expect(
      recordedLabel({ recordedAt: "2026-05-12T23:59:00.000Z", models: ["groq:a", "bedrock:b", "groq:c"] }),
    ).toBe("Recorded on 12 May 2026 with groq:a, bedrock:b and groq:c");
  });

  it("names writing models before the judge, each once", () => {
    expect(
      modelsOf([
        { task: "judge", provider: "groq", model: "j" },
        { task: "rewrite", provider: "groq", model: "w" },
        { task: "regenerate", provider: "groq", model: "w" },
        { task: "judge", provider: "groq", model: "j" },
      ]),
    ).toEqual(["groq:w", "groq:j"]);
  });

  it("always holds the recorded date and every model", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01T00:00:00Z"), max: new Date("2100-01-01T00:00:00Z"), noInvalidDate: true }),
        fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}:[a-z0-9/.-]{1,20}$/), { minLength: 1, maxLength: 4 }),
        (date, models) => {
          const iso = date.toISOString();
          const label = recordedLabel({ recordedAt: iso, models });
          expect(label.startsWith(`Recorded on ${formatRecordedDate(iso)} with `)).toBe(true);
          expect(label).toContain(String(date.getUTCFullYear()));
          for (const m of models) expect(label).toContain(m);
        },
      ),
    );
  });
});
