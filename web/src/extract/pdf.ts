/**
 * Text from a typed PDF with pdf.js (R1.2). Uses the legacy build, which runs
 * in Node without a browser. No worker file is configured: in Node, pdf.js
 * runs its worker code in the same process ("fake worker"). Nothing is
 * rendered, so no canvas is needed.
 *
 * Scanned PDFs (no text layer) return `no_text_layer`. Turning a scanned page
 * into an image for the vision model needs a canvas (`@napi-rs/canvas`, a
 * native module), so it is not done here. The UI asks for a photo or pasted
 * text instead.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { MAX_PDF_PAGES } from "./errors";

export type PdfTextResult =
  | { kind: "text"; text: string; pages: number }
  | { kind: "no_text_layer"; pages: number }
  | { kind: "too_many_pages"; pages: number }
  | { kind: "unreadable" };

/** Fewer letters and digits than this across the whole PDF counts as no text layer. */
export const MIN_TEXT_CHARS = 20;

interface TextItemLike {
  str?: unknown;
  hasEOL?: unknown;
}

/** Join pdf.js text items into lines, then tidy spaces and blank lines. */
export function joinTextItems(items: readonly TextItemLike[]): string {
  let out = "";
  for (const item of items) {
    if (typeof item.str === "string") out += item.str;
    if (item.hasEOL === true) out += "\n";
  }
  return out;
}

export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countTextChars(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  // pdf.js takes ownership of the buffer it is given, so pass a copy.
  const task = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch {
      // Corrupt, encrypted or not really a PDF.
      return { kind: "unreadable" };
    }
    const pages = doc.numPages;
    if (pages > MAX_PDF_PAGES) return { kind: "too_many_pages", pages };

    const pageTexts: string[] = [];
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pageTexts.push(tidyText(joinTextItems(content.items as TextItemLike[])));
      page.cleanup();
    }
    const text = pageTexts.filter((t) => t.length > 0).join("\n\n");
    if (countTextChars(text) < MIN_TEXT_CHARS) return { kind: "no_text_layer", pages };
    return { kind: "text", text, pages };
  } catch {
    return { kind: "unreadable" };
  } finally {
    await task.destroy();
  }
}
