/**
 * PDF rendering with headless Chromium through `playwright-core` (task 28).
 *
 * Why `playwright-core`: it is the driver only (about 14 MB, no browser
 * download, no install script), drives a system Chromium through
 * `executablePath`, and has per-context `javaScriptEnabled: false`, request
 * routing and `page.pdf`. Next.js keeps it out of the server bundle by default
 * (its built-in `serverExternalPackages` list).
 *
 * Which browser: `CHROMIUM_PATH` when set (the Docker image installs Chromium
 * and its libraries, task 32). Otherwise the first browser found at a known
 * path: Chromium on Linux, or Google Chrome or Chromium on macOS for local
 * development. No browser found: `ChromiumUnavailable`, and the route returns
 * 503.
 *
 * - 1 browser per server process, launched on the first export and reused.
 *   It is kept on `globalThis` so route bundles and `next dev` reloads share
 *   it. If it crashes or disconnects, the next export launches a new one.
 * - A new browser context per export, closed afterwards, so nothing carries
 *   over between letters. Contexts are in memory; nothing is written to disk
 *   by us (R7.4).
 * - In each context JavaScript is off, service workers are blocked, the
 *   context is offline, and every request is aborted. The HTML is set with
 *   `page.setContent` and pictures are `data:` URIs, so the page needs no
 *   network and no letter content can leave the server.
 * - Each export has a time limit; on timeout the context is closed.
 */
import { existsSync } from "node:fs";
import type { Browser, BrowserContext } from "playwright-core";

export interface PdfRenderer {
  render(html: string): Promise<Uint8Array>;
}

/** No usable browser. The message names the env variable, never letter content. */
export class ChromiumUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChromiumUnavailable";
  }
}

export class RenderTimeout extends Error {
  constructor() {
    super("PDF render timed out");
    this.name = "RenderTimeout";
  }
}

const KNOWN_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

export const RENDER_TIMEOUT_MS = 30_000;

/** The browser executable to launch. Throws `ChromiumUnavailable` when none is found. */
export function chromiumExecutable(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  const configured = env.CHROMIUM_PATH?.trim();
  if (configured) {
    if (!exists(configured)) throw new ChromiumUnavailable("CHROMIUM_PATH does not point to a file");
    return configured;
  }
  const found = KNOWN_PATHS.find((p) => exists(p));
  if (found === undefined) throw new ChromiumUnavailable("no Chromium found; set CHROMIUM_PATH");
  return found;
}

export interface ChromiumRendererOptions {
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

interface BrowserSlot {
  browser: Promise<Browser> | null;
}

const SHARED = Symbol.for("easy-read.export-browser");

function sharedSlot(): BrowserSlot {
  const store = globalThis as unknown as Record<symbol, BrowserSlot | undefined>;
  return (store[SHARED] ??= { browser: null });
}

async function launch(executablePath: string): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  return chromium.launch({
    executablePath,
    headless: true,
    // /dev/shm is small in Docker; Chromium falls back to /tmp for shared memory.
    args: ["--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--disable-extensions"],
  });
}

function browser(slot: BrowserSlot, env: Record<string, string | undefined>): Promise<Browser> {
  if (slot.browser === null) {
    const pending = (async () => {
      const b = await launch(chromiumExecutable(env));
      b.on("disconnected", () => {
        if (slot.browser === pending) slot.browser = null;
      });
      return b;
    })();
    slot.browser = pending;
    // A failed launch is retried on the next export.
    pending.catch(() => {
      if (slot.browser === pending) slot.browser = null;
    });
  }
  return slot.browser;
}

async function renderIn(context: BrowserContext, html: string, timeoutMs: number): Promise<Uint8Array> {
  await context.route("**/*", (route) => route.abort());
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
  const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  return new Uint8Array(pdf);
}

export function createChromiumRenderer(options: ChromiumRendererOptions = {}): PdfRenderer {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS;
  const slot = sharedSlot();
  return {
    async render(html) {
      const b = await browser(slot, env);
      const context = await b.newContext({
        javaScriptEnabled: false,
        offline: true,
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new RenderTimeout()), timeoutMs);
        });
        return await Promise.race([renderIn(context, html, timeoutMs), timeout]);
      } finally {
        clearTimeout(timer);
        await context.close().catch(() => {});
      }
    },
  };
}

/** Number of pages in a PDF made by Chromium. For logs and the local check only. */
export function pdfPageCount(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString("latin1");
  return (text.match(/\/Type\s*\/Page(?![s\w])/gu) ?? []).length;
}
