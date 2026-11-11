/**
 * `/api/export` and the print layout (task 28; R4.4, R7.1, R8.1 to R8.3,
 * R9.5). The checker, the renderer and the picture loader are fakes, so no
 * browser starts and no request leaves the machine. The letter here is
 * invented. Assertions on HTML use `includes` on booleans, so a failure never
 * prints the document.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import type { CheckResult, KeyFact, Line, Sentence } from "@/src/checker-client/schemas";
import {
  ChromiumUnavailable,
  type ExportHandlerDeps,
  type ExportLogEvent,
  type ExportRouteChecker,
  MAX_EXPORT_BODY_BYTES,
  type PdfRenderer,
  PRINT_CSS,
  QueueFullError,
  chromiumExecutable,
  createExportQueue,
  handleExport,
  printDocument,
  renderPrintHtml,
} from "@/src/export";
import { NOTICE, RULES } from "@/src/pipeline/decide";
import type { ConversionResult } from "@/src/pipeline/types";
import { DAILY_CAP_EXEMPT, ROUTE_COSTS, createRateLimiter } from "@/src/rate-limit";
import { ARASAAC_ATTRIBUTION } from "@/src/symbols/attribution";

// ---------- an invented letter and its result ----------

const SENTENCES = ["Please pay £45 by 1 April 2026.", "Call 0300 123 4567 with questions.", "We got your form."];
const ORIGINAL = SENTENCES.join(" ");
const LINES: Line[] = [
  { id: "l1", text: "You need to pay £45 by 1 April 2026.", source_sentence_id: "s1", symbol_id: "2418" },
  { id: "l2", text: "You can phone 0300 123 4567 with questions.", source_sentence_id: "s2", symbol_id: null },
  { id: "l3", text: "The council got your form.", source_sentence_id: "s3", symbol_id: "2418" },
];

function analysis(original: string): { sentences: Sentence[]; key_facts: KeyFact[] } {
  const sentences: Sentence[] = [];
  let cursor = 0;
  SENTENCES.forEach((text, i) => {
    const start = original.indexOf(text, cursor);
    sentences.push({ id: `s${i + 1}`, text, start, end: start + text.length });
    cursor = start + text.length;
  });
  const at = original.indexOf("£45");
  return {
    sentences,
    key_facts: [{ id: "f1", type: "money", value: "£45", normalised: "GBP45.00", start: at, end: at + 3, sentence_id: "s1" }],
  };
}

const pass = (rule: CheckResult["rule"]): CheckResult => ({ rule, passed: true, line_ids: [], failed_fact_ids: [], details: [] });

function result(overrides: Partial<ConversionResult> = {}): ConversionResult {
  const a = analysis(ORIGINAL);
  return {
    status: "passed",
    original: { text: ORIGINAL, sentences: a.sentences },
    keyFacts: a.key_facts,
    lines: LINES.map((l) => ({ ...l })),
    checks: RULES.map(pass),
    attempts: 1,
    notice: NOTICE,
    judgeAvailable: true,
    models: [],
    actionSynonyms: [],
    lineFacts: [],
    ...overrides,
  };
}

// ---------- fakes ----------

interface Seen {
  health: number;
  checked: number;
  renders: string[];
}

const newSeen = (): Seen => ({ health: 0, checked: 0, renders: [] });

type RuleOutcomes = Partial<Record<"P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8", boolean>>;

function fakeChecker(seen: Seen, opts: { down?: boolean; outcomes?: RuleOutcomes } = {}): ExportRouteChecker {
  return {
    async health() {
      seen.health += 1;
      if (opts.down) throw new CheckerUnavailable("/health", "network");
      return { status: "ok" };
    },
    async analyse(original) {
      return analysis(original);
    },
    async check(request) {
      seen.checked += 1;
      return (["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"] as const).map((rule) => {
        const passed = opts.outcomes?.[rule] ?? true;
        return {
          rule,
          passed,
          line_ids: passed ? [] : [request.lines[0].id],
          failed_fact_ids: rule === "P1" && !passed ? ["f1"] : [],
          details: passed ? [] : [`${request.lines[0].id} failed`],
        };
      });
    },
  };
}

const FAKE_PDF = new TextEncoder().encode("%PDF-1.4 fake");
const PNG_URI = "data:image/png;base64,iVBORw0KGgo=";

function fakeRenderer(seen: Seen): PdfRenderer {
  return {
    async render(html) {
      seen.renders.push(html);
      return FAKE_PDF;
    },
  };
}

function deps(seen: Seen, extra: Partial<ExportHandlerDeps> & { checker?: ExportRouteChecker } = {}): ExportHandlerDeps {
  const { checker, ...rest } = extra;
  return {
    getChecker: () => checker ?? fakeChecker(seen),
    getRenderer: () => fakeRenderer(seen),
    queue: createExportQueue(),
    loadPicture: async () => PNG_URI,
    rateLimit: async () => ({ allowed: true }),
    logger: () => {},
    ...rest,
  };
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

// ---------- tests ----------

describe("/api/export", () => {
  it("returns an A4 PDF as an attachment for a passing result", async () => {
    const seen = newSeen();
    const res = await handleExport(request(result()), deps(seen));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="easy-read.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FAKE_PDF);
    expect(seen.checked).toBe(1);
    expect(seen.renders).toHaveLength(1);
  });

  it("puts the notice, the attribution and every line in the HTML, with no script", async () => {
    const seen = newSeen();
    // The client's notice is ignored: the server always prints its own (R7.1).
    await handleExport(request(result({ notice: "x" })), deps(seen));
    const html = seen.renders[0];
    expect(html.includes(NOTICE)).toBe(true);
    expect(html.includes(ARASAAC_ATTRIBUTION)).toBe(true);
    for (const line of LINES) expect(html.includes(line.text)).toBe(true);
    expect(/<script/iu.test(html)).toBe(false);
    expect(html.includes("@page { size: A4")).toBe(true);
    // The notice comes before the first line, so it is at the top of page 1.
    expect(html.indexOf(NOTICE) < html.indexOf(LINES[0].text)).toBe(true);
    // Pictures are inlined; the page links to nothing.
    expect(html.includes(PNG_URI)).toBe(true);
    expect(/\s(src|href)="(?!data:)/u.test(html)).toBe(false);
  });

  it("gives 409 without checking or rendering when the client says blocked", async () => {
    const seen = newSeen();
    const res = await handleExport(request(result({ status: "blocked", lines: [] })), deps(seen));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("blocked");
    expect(seen.health).toBe(0);
    expect(seen.renders).toHaveLength(0);
  });

  it("gives 409 when the client says blocked but still sends lines", async () => {
    const seen = newSeen();
    const res = await handleExport(request(result({ status: "blocked" })), deps(seen));
    expect(res.status).toBe(409);
    expect(seen.renders).toHaveLength(0);
  });

  it("gives 409 without rendering when P1 fails on the server, whatever the client says", async () => {
    const seen = newSeen();
    const checker = fakeChecker(seen, { outcomes: { P1: false } });
    const res = await handleExport(request(result({ status: "passed" })), deps(seen, { checker }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("blocked");
    expect(seen.checked).toBe(1);
    expect(seen.renders).toHaveLength(0);
  });

  it("exports a flagged result and names the failed checks in the PDF", async () => {
    const seen = newSeen();
    const checker = fakeChecker(seen, { outcomes: { P5: false } });
    const res = await handleExport(request(result({ status: "flagged" })), deps(seen, { checker }));
    expect(res.status).toBe(200);
    const html = seen.renders[0];
    expect(html.includes("9 of 10 checks passed")).toBe(true);
    expect(html.includes("Checks that did not pass: Plain words.")).toBe(true);
    expect(html.includes("Failed: Plain words")).toBe(true);
  });

  it("rejects bad bodies with 400 before any checker call", async () => {
    const good = result();
    const bad: unknown[] = [
      "not json",
      {},
      { ...good, lines: undefined },
      { ...good, status: "great" },
      { ...good, lines: [{ ...LINES[0], text: "x".repeat(301) }] },
      { ...good, lines: [{ ...LINES[0], text: "" }] },
      { ...good, lines: [LINES[0], { ...LINES[1], id: "l1" }] },
      { ...good, lines: [{ ...LINES[0], id: "has space" }] },
      { ...good, original: { ...good.original, text: "   " } },
    ];
    for (const body of bad) {
      const seen = newSeen();
      const res = await handleExport(request(body), deps(seen));
      expect(res.status).toBe(400);
      expect(seen.health).toBe(0);
    }
  });

  it("gives 400 when a line's source sentence isn't in the server's analysis", async () => {
    const seen = newSeen();
    const lines = [{ ...LINES[0], source_sentence_id: "s99" }];
    const res = await handleExport(request(result({ lines })), deps(seen));
    expect(res.status).toBe(400);
    expect(seen.renders).toHaveLength(0);
  });

  it("gives 413 for a body over the limit", async () => {
    const seen = newSeen();
    const res = await handleExport(request("x".repeat(MAX_EXPORT_BODY_BYTES + 1)), deps(seen));
    expect(res.status).toBe(413);
  });

  it("gives 503 when the checker is down", async () => {
    const seen = newSeen();
    const res = await handleExport(request(result()), deps(seen, { checker: fakeChecker(seen, { down: true }) }));
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("checker_unavailable");
    expect(seen.renders).toHaveLength(0);
  });

  it("gives 503 when no browser is available, and 500 when the render fails", async () => {
    const seen = newSeen();
    const noBrowser = await handleExport(
      request(result()),
      deps(seen, {
        getRenderer: () => {
          throw new ChromiumUnavailable("no Chromium found; set CHROMIUM_PATH");
        },
      }),
    );
    expect(noBrowser.status).toBe(503);
    expect(await errorCode(noBrowser)).toBe("export_unavailable");
    const failed = await handleExport(
      request(result()),
      deps(seen, { getRenderer: () => ({ render: async () => Promise.reject(new Error("crash")) }) }),
    );
    expect(failed.status).toBe(500);
    expect(await errorCode(failed)).toBe("export_failed");
  });

  it("gives 503 when the export queue is full", async () => {
    const seen = newSeen();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const shared = deps(seen, {
      queue: createExportQueue({ maxConcurrent: 1, maxQueued: 0 }),
      getRenderer: () => ({ render: async () => (await held, FAKE_PDF) }),
    });
    const first = handleExport(request(result()), shared);
    await new Promise((r) => setTimeout(r, 0));
    const second = await handleExport(request(result()), shared);
    expect(second.status).toBe(503);
    expect(await errorCode(second)).toBe("busy");
    expect(second.headers.get("retry-after")).toBe("30");
    release();
    expect((await first).status).toBe(200);
  });

  it("gives 503 when an export waits too long in the queue", async () => {
    const seen = newSeen();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const shared = deps(seen, {
      queue: createExportQueue({ maxConcurrent: 1, maxQueued: 1, waitTimeoutMs: 20 }),
      getRenderer: () => ({ render: async () => (await held, FAKE_PDF) }),
    });
    const first = handleExport(request(result()), shared);
    const second = await handleExport(request(result()), shared);
    expect(second.status).toBe(503);
    release();
    expect((await first).status).toBe(200);
  });

  it("uses the shared limiter as route export, outside the daily model cap", async () => {
    expect(ROUTE_COSTS.export).toBe(3);
    expect(DAILY_CAP_EXEMPT.has("export")).toBe(true);
    const limiter = createRateLimiter({ capacity: 6, refillPerHour: 1, dailyCap: 6, logger: () => {} });
    const seen = newSeen();
    const d = deps(seen, { rateLimit: limiter.limit });
    expect((await handleExport(request(result()), d)).status).toBe(200);
    expect((await handleExport(request(result()), d)).status).toBe(200);
    const third = await handleExport(request(result()), d);
    expect(third.status).toBe(429);
    expect(await errorCode(third)).toBe("rate_limited");
    expect(limiter.usedToday()).toBe(0);
  });

  it("never logs letter text, lines or key-fact values", async () => {
    const events: ExportLogEvent[] = [];
    const seen = newSeen();
    await handleExport(request(result()), deps(seen, { logger: (e) => events.push(e) }));
    await handleExport(request(result({ status: "blocked", lines: [] })), deps(seen, { logger: (e) => events.push(e) }));
    const logged = JSON.stringify(events);
    expect(events).toHaveLength(2);
    expect(logged.includes("£45")).toBe(false);
    expect(logged.includes("council")).toBe(false);
    expect(logged.includes("0300")).toBe(false);
  });

  /**
   * Property: for any arrival pattern, no more than 2 renders run at once,
   * a waiting export starts as soon as a slot is free, and every export
   * finishes with a PDF.
   * **Validates: Requirements 8.1** (design "Deployment": 2 exports at once, the rest queued)
   */
  it("never runs more than 2 renders at once, for any arrival pattern", async () => {
    const step = fc.oneof(fc.constant({ kind: "arrive" as const }), fc.nat(20).map((n) => ({ kind: "finish" as const, n })));
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 30 }), async (steps) => {
        const seen = newSeen();
        let active = 0;
        let maxActive = 0;
        const running: (() => void)[] = [];
        const d = deps(seen, {
          queue: createExportQueue({ maxQueued: 100, waitTimeoutMs: 60_000 }),
          getRenderer: () => ({
            render: async () => {
              active += 1;
              maxActive = Math.max(maxActive, active);
              await new Promise<void>((r) => running.push(r));
              active -= 1;
              return FAKE_PDF;
            },
          }),
        });
        const flush = () => new Promise((r) => setTimeout(r, 0));
        const pending: Promise<Response>[] = [];
        for (const s of steps) {
          if (s.kind === "arrive") pending.push(handleExport(request(result()), d));
          else if (running.length > 0) running.splice(s.n % running.length, 1)[0]();
          await flush();
          expect(active).toBeLessThanOrEqual(2);
          // Work-conserving: if any export is still waiting, both slots are busy.
          const { queued } = d.queue.stats();
          if (queued > 0) expect(active).toBe(2);
        }
        while (pending.length > 0 && (running.length > 0 || d.queue.stats().queued > 0 || active > 0)) {
          running.splice(0).forEach((r) => r());
          await flush();
        }
        const statuses = await Promise.all(pending.map((p) => p.then((r) => r.status)));
        expect(statuses.every((s) => s === 200)).toBe(true);
        expect(maxActive).toBeLessThanOrEqual(2);
      }),
      { numRuns: 100 },
    );
  });
});

describe("export queue", () => {
  it("rejects at once when the queue is full", async () => {
    const queue = createExportQueue({ maxConcurrent: 1, maxQueued: 0 });
    let release!: () => void;
    const first = queue.run(() => new Promise<void>((r) => (release = r)));
    await expect(queue.run(async () => 1)).rejects.toBeInstanceOf(QueueFullError);
    release();
    await first;
    expect(queue.stats()).toEqual({ active: 0, queued: 0 });
  });
});

describe("print layout", () => {
  it("escapes line text, so markup in a line is shown as text", () => {
    const doc = printDocument({
      ...result(),
      lines: [{ id: "l1", text: '<script>alert("x")</script> & <img src=x>', source_sentence_id: "s1", symbol_id: null }],
    });
    const html = renderPrintHtml(doc, new Map());
    expect(/<script/iu.test(html)).toBe(false);
    expect(html.includes("<img src=x>")).toBe(false);
    expect(html.includes("&lt;script&gt;")).toBe(true);
  });

  it("only puts PNG data URIs in a picture src", () => {
    const doc = printDocument(result());
    const html = renderPrintHtml(doc, new Map([["2418", "https://example.com/x.png"]]));
    expect(html.includes("example.com")).toBe(false);
    expect(html.includes("<img")).toBe(false);
  });

  it("uses 16pt or more for every font size, A4 pages and rows that don't split", () => {
    const sizes = [...PRINT_CSS.matchAll(/font-size:\s*(\d+)pt/gu)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((s) => s >= 16)).toBe(true);
    expect(/font-size:\s*\d+(px|em|rem)/u.test(PRINT_CSS)).toBe(false);
    expect(PRINT_CSS.includes("@page { size: A4;")).toBe(true);
    expect(/\.er-row \{[^}]*break-inside: avoid/u.test(PRINT_CSS)).toBe(true);
  });

  it("puts the picture before the text in each row", () => {
    const html = renderPrintHtml(printDocument(result()), new Map([["2418", PNG_URI]]));
    const row = html.slice(html.indexOf('<li class="er-row">'), html.indexOf("</li>"));
    expect(row.indexOf("er-picture") < row.indexOf("er-text")).toBe(true);
  });
});

describe("chromiumExecutable", () => {
  it("uses CHROMIUM_PATH when it exists", () => {
    expect(chromiumExecutable({ CHROMIUM_PATH: "/opt/chromium" }, (p) => p === "/opt/chromium")).toBe("/opt/chromium");
  });

  it("fails when CHROMIUM_PATH points nowhere, or when no browser is found", () => {
    expect(() => chromiumExecutable({ CHROMIUM_PATH: "/nope" }, () => false)).toThrow(ChromiumUnavailable);
    expect(() => chromiumExecutable({}, () => false)).toThrow(ChromiumUnavailable);
  });

  it("falls back to a known install path", () => {
    expect(chromiumExecutable({}, (p) => p === "/usr/bin/chromium")).toBe("/usr/bin/chromium");
  });
});
