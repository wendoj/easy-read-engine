/**
 * The print layout as one static HTML string, for headless Chromium
 * (`page.setContent`). Server only in practice, but pure.
 *
 * Why a string and not React: route handlers run in the React Server
 * Components layer, where `react-dom/server` resolves to a stub that throws.
 * So the export builds the same `PrintDocument` as the `/print` page and
 * renders it here with the same class names and `PRINT_CSS`.
 *
 * - Every value is HTML-escaped. There is no `<script>` and no inline event
 *   handler, and a Content-Security-Policy allows only inline styles and
 *   `data:` images. JavaScript is also off in the Chromium context.
 * - Pictures are `data:image/png;base64,...` URIs read on the server from the
 *   pictogram cache, so the page makes no network request at all.
 */
import { MAX_ID_CHARS } from "@/src/check/errors";
import { CHECKS_HEADING, PRINT_CSS, type PrintDocument, failedCheckText } from "./print-document";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (c) => ESCAPES[c] ?? c);
}

const PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u;

export const PRINT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/** Pictures by symbol ID, as PNG data URIs. A missing ID gives an empty picture slot. */
export type PictureMap = ReadonlyMap<string, string>;

function picture(symbolId: string | null, pictures: PictureMap): string {
  const src = symbolId !== null && symbolId.length <= MAX_ID_CHARS ? pictures.get(symbolId) : undefined;
  // Only PNG data URIs are ever put in a src, so nothing can point off the page.
  if (src === undefined || !PNG_DATA_URI.test(src)) return '<div class="er-picture" aria-hidden="true"></div>';
  return `<img class="er-picture" src="${escapeHtml(src)}" alt="">`;
}

export function renderPrintHtml(doc: PrintDocument, pictures: PictureMap): string {
  const rows = doc.rows
    .map((row) => `<li class="er-row">${picture(row.symbolId, pictures)}<p class="er-text">${escapeHtml(row.text)}</p></li>`)
    .join("");
  const failed =
    doc.failedChecks.length === 0
      ? ""
      : `<ul>${doc.failedChecks.map((c) => `<li>${escapeHtml(failedCheckText(c))}</li>`).join("")}</ul>`;
  // Plain text in the PDF: the URL is part of the attribution text already.
  const attribution = doc.attribution.map((part) => escapeHtml(part.text)).join("");
  return [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PRINT_CSP)}">`,
    `<title>${escapeHtml(doc.title)}</title>`,
    `<style>${PRINT_CSS}</style>`,
    '</head><body style="margin:0;background:#ffffff">',
    '<main class="er-print">',
    `<h1 class="er-title">${escapeHtml(doc.title)}</h1>`,
    `<p class="er-notice" role="note">${escapeHtml(doc.notice)}</p>`,
    `<ul class="er-lines">${rows}</ul>`,
    `<section class="er-checks"><h2>${escapeHtml(CHECKS_HEADING)}</h2><p>${escapeHtml(doc.passLabel)}</p>${failed}</section>`,
    `<footer class="er-footer"><p>${attribution}</p></footer>`,
    "</main></body></html>",
  ].join("");
}
