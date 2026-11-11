/**
 * `GET /symbols/<id>`: an ARASAAC pictogram PNG, from the local cache
 * (design "Symbols", "Deployment").
 *
 * - The ID must be digits only (ARASAAC IDs, as in `checker/data/symbols.json`).
 *   Anything else is a 400 and never reaches a file path or a URL.
 * - First request: fetch the PNG from ARASAAC's image server, check it is a
 *   PNG of a sane size, and write it to the cache directory atomically (temp
 *   file, then rename). Parallel requests for the same ID share one fetch.
 * - Later requests, and the PDF export, read the cached file.
 * - Responses carry a long, immutable Cache-Control: a pictogram ID's image
 *   doesn't change.
 *
 * The cache directory is the `symbol-cache` volume. It holds only pictograms,
 * never letter content (R7.4). The pictograms are CC BY-NC-SA (see
 * checker/data/LICENSE-pictograms.md).
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** 500 px is the size ARASAAC serves by default; enough for screen and A4 print. */
export function arasaacImageUrl(id: string): string {
  return `https://static.arasaac.org/pictograms/${id}/${id}_500.png`;
}

/** Digits only, up to 10 of them. ARASAAC IDs are currently 4 to 5 digits. */
const SYMBOL_ID = /^[0-9]{1,10}$/;
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** ARASAAC 500 px PNGs are about 10 to 60 KB. */
export const MAX_SYMBOL_BYTES = 2 * 1024 * 1024;
export const SYMBOL_FETCH_TIMEOUT_MS = 10_000;
export const SYMBOL_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface SymbolImageDeps {
  /** Absolute path of the cache directory. Created on first write. */
  cacheDir: string;
  /** Injectable for tests. Defaults to global `fetch`. */
  fetch?: FetchFn;
  timeoutMs?: number;
}

/** `SYMBOL_CACHE_DIR`, or `symbol-cache` under the working directory (gitignored). */
export function symbolCacheDir(env: Record<string, string | undefined> = process.env): string {
  // Runtime-only path (a Docker volume), so keep it out of build tracing.
  return path.resolve(/*turbopackIgnore: true*/ env.SYMBOL_CACHE_DIR || "symbol-cache");
}

export function isSymbolId(id: string): boolean {
  return SYMBOL_ID.test(id);
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function png(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(bytes.length),
      "cache-control": SYMBOL_CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    },
  });
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

class UpstreamError extends Error {
  constructor(readonly status: 404 | 502) {
    super(status === 404 ? "pictogram not found" : "pictogram server unavailable");
    this.name = "UpstreamError";
  }
}

async function readCached(file: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function download(id: string, fetchFn: FetchFn, timeoutMs: number): Promise<Uint8Array> {
  let res: Response;
  let bytes: Uint8Array;
  try {
    res = await fetchFn(arasaacImageUrl(id), { method: "GET", headers: { accept: "image/png" }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404) throw new UpstreamError(404);
    if (!res.ok) throw new UpstreamError(502);
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_SYMBOL_BYTES) throw new UpstreamError(502);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(502);
  }
  if (bytes.length > MAX_SYMBOL_BYTES || !isPng(bytes)) throw new UpstreamError(502);
  return bytes;
}

async function writeAtomically(dir: string, file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, file);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/** One fetch per ID at a time, per process and cache directory. */
const inFlight = new Map<string, Promise<Uint8Array>>();

export async function handleSymbolImage(id: string, deps: SymbolImageDeps): Promise<Response> {
  if (!isSymbolId(id)) return error(400, "invalid pictogram ID");

  const dir = path.resolve(deps.cacheDir);
  const file = path.join(dir, `${id}.png`);
  const cached = await readCached(file);
  if (cached !== undefined && isPng(cached)) return png(cached);

  const key = file;
  let pending = inFlight.get(key);
  if (!pending) {
    const fetchFn: FetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
    pending = (async () => {
      const bytes = await download(id, fetchFn, deps.timeoutMs ?? SYMBOL_FETCH_TIMEOUT_MS);
      await writeAtomically(dir, file, bytes);
      return bytes;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  try {
    return png(await pending);
  } catch (err) {
    if (err instanceof UpstreamError) return error(err.status, err.message);
    throw err;
  }
}
