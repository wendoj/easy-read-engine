/**
 * `/api/extract` (task 18; R1.2, R1.3, R1.4). The model client is a fake, so
 * no request leaves the machine. Assertions on letter text use `includes`,
 * never `toContain`/`toEqual` on the text, so a failure never prints it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ExtractLogEvent,
  MAX_FILE_BYTES,
  detectFileType,
  handleExtract,
} from "@/src/extract";
import { type ChatRequest, type ChatResult, type ModelClient, ProviderChainError } from "@/src/llm/client";
import type { Role } from "@/src/llm/config";
import { loadPrompt } from "@/src/llm/prompts";

// ---------- helpers ----------

/** A valid PDF with one page per entry. `null` makes a page with no text. */
function makePdf(pages: (string | null)[]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const text of pages) {
    let contents = "";
    if (text !== null) {
      const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
      const id = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      contents = ` /Contents ${id} 0 R`;
    }
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >>${contents} >>`,
      ),
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP_BYTES = new TextEncoder().encode("RIFF\x10\0\0\0WEBPVP8 ");

interface FakeClient extends ModelClient {
  calls: { role: Role; request: ChatRequest }[];
  built: number;
}

type Reply = { handwritten: boolean; readable: boolean; text: string } | Error;

/** Answers each vision request with the next reply in the list, through the `submit_page` tool. */
function fakeClient(replies: Reply[]): FakeClient {
  const calls: FakeClient["calls"] = [];
  const client: FakeClient = {
    calls,
    built: 0,
    async chat(role, request): Promise<ChatResult> {
      calls.push({ role, request });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (reply instanceof Error) throw reply;
      return {
        message: {
          content: null,
          tool_calls: [{ id: "1", type: "function", function: { name: "submit_page", arguments: JSON.stringify(reply) } }],
        },
        finishReason: "tool_calls",
        provider: "groq",
        model: "fake-vision",
        attempts: [],
      };
    },
  };
  return client;
}

function deps(client: FakeClient, extra: { logs?: ExtractLogEvent[]; sleeps?: number[] } = {}) {
  return {
    getClient: () => {
      client.built++;
      return client;
    },
    logger: (e: ExtractLogEvent) => extra.logs?.push(e),
    structured: { logger: () => {} },
    sleep: async (ms: number) => {
      extra.sleeps?.push(ms);
    },
  };
}

function upload(bytes: Uint8Array, name = "letter", type = "application/octet-stream"): Request {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name, { type }));
  return new Request("http://localhost/api/extract", { method: "POST", body: form });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

const NO_CALLS = (client: FakeClient) => {
  expect(client.calls).toHaveLength(0);
  expect(client.built).toBe(0);
};

// ---------- tests ----------

describe("detectFileType", () => {
  it("reads magic bytes, not names or MIME types", () => {
    expect(detectFileType(makePdf(["x"]))).toBe("pdf");
    expect(detectFileType(PNG_BYTES)).toBe("png");
    expect(detectFileType(JPEG_BYTES)).toBe("jpeg");
    expect(detectFileType(WEBP_BYTES)).toBe("webp");
    expect(detectFileType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(detectFileType(new TextEncoder().encode("RIFF\0\0\0\0WAVE"))).toBeNull();
    expect(detectFileType(new Uint8Array())).toBeNull();
  });
});

describe("POST /api/extract with a PDF", () => {
  it("extracts the text of a typed PDF with pdf.js, without a model call", async () => {
    const client = fakeClient([]);
    const logs: ExtractLogEvent[] = [];
    const res = await handleExtract(
      upload(makePdf(["Pay 45 pounds by 1 April 2026.", "Reference AB123456."]), "x.pdf", "application/pdf"),
      deps(client, { logs }),
    );
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.source).toBe("pdf");
    const text = json.text as string;
    expect(text === "Pay 45 pounds by 1 April 2026.\n\nReference AB123456.").toBe(true);
    NO_CALLS(client);
    // Logs hold the outcome only, never the text.
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ msg: "extract", source: "pdf", outcome: "ok" });
    expect(JSON.stringify(logs).includes("AB123456")).toBe(false);
  });

  it("extracts text from a public fixture PDF", async () => {
    const file = path.resolve(process.cwd(), "../fixtures/letters/council-tax-final-notice-east-cambridgeshire.pdf");
    const client = fakeClient([]);
    const res = await handleExtract(upload(new Uint8Array(await readFile(file)), "letter.pdf"), deps(client));
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.source).toBe("pdf");
    expect((json.text as string).length > 1000).toBe(true);
    expect((json.text as string).includes("Council Tax")).toBe(true);
    NO_CALLS(client);
  });

  it("returns no_text_layer for a PDF with no text, without a model call", async () => {
    const client = fakeClient([]);
    const res = await handleExtract(upload(makePdf([null, null])), deps(client));
    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe("no_text_layer");
    NO_CALLS(client);
  });

  it("returns unreadable for a broken PDF", async () => {
    const client = fakeClient([]);
    const res = await handleExtract(upload(new TextEncoder().encode("%PDF-1.4\nnot really a pdf")), deps(client));
    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe("unreadable");
    NO_CALLS(client);
  });
});

describe("POST /api/extract checks type and size before any model call", () => {
  it("rejects a file whose bytes are not a PDF or image, whatever its name and MIME type", async () => {
    const client = fakeClient([]);
    const res = await handleExtract(
      upload(new TextEncoder().encode("GIF89a........"), "letter.pdf", "application/pdf"),
      deps(client),
    );
    expect(res.status).toBe(400);
    const json = await body(res);
    expect(json.error).toBe("unsupported_type");
    expect(typeof json.message).toBe("string");
    NO_CALLS(client);
  });

  it("rejects a file over the size limit", async () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(JPEG_BYTES);
    const client = fakeClient([]);
    const res = await handleExtract(upload(big, "photo.jpg", "image/jpeg"), deps(client));
    expect(res.status).toBe(413);
    expect((await body(res)).error).toBe("too_large");
    NO_CALLS(client);
  });

  it("rejects a declared body over the limit without reading it", async () => {
    const client = fakeClient([]);
    const req = new Request("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-length": String(MAX_FILE_BYTES * 2), "content-type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    const res = await handleExtract(req, deps(client));
    expect(res.status).toBe(413);
    NO_CALLS(client);
  });

  it("rejects a request with no file", async () => {
    const client = fakeClient([]);
    const form = new FormData();
    form.append("file", "just a string");
    const res = await handleExtract(new Request("http://localhost/api/extract", { method: "POST", body: form }), deps(client));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("invalid_request");
    NO_CALLS(client);
  });
});

describe("POST /api/extract with a photo", () => {
  it("sends the image to the vision role with the vision prompt", async () => {
    const client = fakeClient([{ handwritten: false, readable: true, text: "Your repair visit is on 3 March 2026." }]);
    const res = await handleExtract(upload(PNG_BYTES, "photo", "text/plain"), deps(client));
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.source).toBe("image");
    expect(json.text === "Your repair visit is on 3 March 2026.").toBe(true);

    expect(client.calls).toHaveLength(1);
    const { role, request } = client.calls[0];
    expect(role).toBe("vision");
    const vision = await loadPrompt("vision");
    expect(request.messages[0]).toEqual({ role: "system", content: vision.system });
    const parts = request.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0]).toEqual({ type: "text", text: vision.user });
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url?.url).toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`);
    expect((request.tool_choice as { function: { name: string } }).function.name).toBe("submit_page");
  });

  it("maps a handwritten page to error handwriting (R1.4)", async () => {
    const client = fakeClient([{ handwritten: true, readable: true, text: "" }]);
    const res = await handleExtract(upload(JPEG_BYTES), deps(client));
    expect(res.status).toBe(422);
    const json = await body(res);
    expect(json.error).toBe("handwriting");
    expect((json.message as string).includes("handwritten")).toBe(true);
    expect(json.text).toBeUndefined();
  });

  it("maps an unreadable or empty page to error unreadable", async () => {
    for (const reply of [
      { handwritten: false, readable: false, text: "" },
      { handwritten: false, readable: true, text: "   " },
    ]) {
      const res = await handleExtract(upload(WEBP_BYTES), deps(fakeClient([reply])));
      expect(res.status).toBe(422);
      expect((await body(res)).error).toBe("unreadable");
    }
  });

  it("returns 503 when every vision provider fails", async () => {
    const client = fakeClient([new ProviderChainError("vision", [], undefined)]);
    const sleeps: number[] = [];
    const res = await handleExtract(upload(PNG_BYTES), deps(client, { sleeps }));
    expect(res.status).toBe(503);
    expect((await body(res)).error).toBe("providers_unavailable");
    expect(client.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("waits once for Retry-After, tries again, then returns 503 with Retry-After", async () => {
    const client = fakeClient([new ProviderChainError("vision", [], 5000)]);
    const sleeps: number[] = [];
    const res = await handleExtract(upload(PNG_BYTES), deps(client, { sleeps }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(sleeps).toEqual([5000]);
    expect(client.calls).toHaveLength(2);
  });

  it("succeeds if the provider answers after the one wait", async () => {
    const client = fakeClient([
      new ProviderChainError("vision", [], 1000),
      { handwritten: false, readable: true, text: "Printed text." },
    ]);
    const res = await handleExtract(upload(PNG_BYTES), deps(client));
    expect(res.status).toBe(200);
    expect(client.calls).toHaveLength(2);
  });
});

describe("rate limit hook", () => {
  it("returns the limiter's status before reading the file", async () => {
    const client = fakeClient([]);
    const res = await handleExtract(upload(PNG_BYTES), {
      ...deps(client),
      rateLimit: async () => ({ allowed: false, status: 429, code: "rate_limited", message: "Too many requests." }),
    });
    expect(res.status).toBe(429);
    expect((await body(res)).error).toBe("rate_limited");
    NO_CALLS(client);
  });
});
