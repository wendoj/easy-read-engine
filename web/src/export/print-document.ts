/**
 * The print layout as data, shared by the PDF export (`print-html.ts`, static
 * HTML for headless Chromium) and the `/print` page (React, for a browser
 * print preview). Both render the same `PrintDocument` with the same class
 * names and `PRINT_CSS`, so the preview shows what the PDF holds (task 28,
 * R8.1, R8.2, R8.3, R7.1, R4.4).
 *
 * Layout: A4, all text 16pt or larger, one Easy Read line per row with its
 * picture on the left, the R7.1 notice at the top of page 1, and the ARASAAC
 * attribution and licence in the footer. Rows never split across pages.
 *
 * Failed rules are never hidden (R3.4): the pass count and the names of the
 * failed checks are under the notice, and each affected line has a marker.
 *
 * Browser-safe: imports only pure helpers and constants. Nothing here logs.
 */
import { ARASAAC_ATTRIBUTION_PARTS } from "@/src/symbols/attribution";
import type { ConversionResult } from "@/src/pipeline/types";
import { lineMarkerLabel, lineMarkers, passCount, ruleRows } from "@/src/ui/rule-report";

export const PRINT_TITLE = "Easy Read version";

export interface PrintRow {
  id: string;
  text: string;
  /** Null when the line has no picture. The row keeps an empty picture slot. */
  symbolId: string | null;
  /** "Failed: Plain words" when the line failed a check, otherwise null. */
  marker: string | null;
}

export interface PrintDocument {
  title: string;
  /** The R7.1 statement, at the top of page 1. */
  notice: string;
  /** For example "10 of 10 checks passed". */
  passLabel: string;
  /** Names of the failed checks, in rule order. Empty when every check passed. */
  failedChecks: string[];
  rows: PrintRow[];
  attribution: readonly { text: string; href?: string }[];
}

export type PrintInput = Pick<ConversionResult, "checks" | "lines" | "keyFacts" | "judgeAvailable" | "notice">;

export function printDocument(input: PrintInput): PrintDocument {
  const markers = lineMarkers(input);
  return {
    title: PRINT_TITLE,
    notice: input.notice,
    passLabel: passCount(input).label,
    failedChecks: ruleRows(input)
      .filter((r) => !r.passed)
      .map((r) => r.name),
    rows: input.lines.map((line) => {
      const rules = markers.get(line.id);
      return {
        id: line.id,
        text: line.text,
        symbolId: line.symbol_id,
        marker: rules && rules.length > 0 ? lineMarkerLabel(rules) : null,
      };
    }),
    attribution: ARASAAC_ATTRIBUTION_PARTS,
  };
}

/** "Checks that did not pass: Short sentences, Plain words." */
export function failedChecksText(names: readonly string[]): string {
  return `Checks that did not pass: ${names.join(", ")}.`;
}

/** Smallest font size in the layout, in points (ui.md: at least 16pt). */
export const MIN_FONT_PT = 16;

/**
 * Print CSS for both renderers. Scoped to `.er-print` so it doesn't change the
 * rest of the app when the `/print` page shows it. `@page` applies only when
 * printing. Fonts: Arial or Liberation Sans if installed, else any sans-serif.
 * Easy Read print conventions (README "Easy Read guidance"): 18pt text, 20pt
 * lines, left-aligned, no italics or capitals, the picture left of each line,
 * dark text on white, and borders dark enough to see when printed.
 */
export const PRINT_CSS = `
@page { size: A4; margin: 15mm 15mm 15mm 15mm; }
.er-print {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  box-sizing: border-box;
  max-width: 180mm;
  margin: 0 auto;
  padding: 0;
  background: #ffffff;
  color: #111111;
  font-family: Arial, "Liberation Sans", Helvetica, sans-serif;
  font-size: 18pt;
  line-height: 1.5;
  text-align: left;
}
.er-print *, .er-print *::before, .er-print *::after { box-sizing: border-box; }
.er-print .er-title { font-size: 26pt; font-weight: 700; line-height: 1.2; margin: 0 0 6mm; }
.er-print .er-notice {
  margin: 0 0 6mm;
  padding: 4mm 5mm;
  background: #fbfaf7;
  border: 1.5pt solid #1a1a1a;
  border-radius: 3mm;
  font-size: 18pt;
  font-weight: 700;
}
.er-print .er-checks { margin: 0 0 6mm; font-size: 16pt; }
.er-print .er-checks p { margin: 0; }
.er-print .er-lines { list-style: none; margin: 0; padding: 0; }
.er-print .er-row {
  display: flex;
  align-items: center;
  gap: 6mm;
  padding: 5mm 0;
  border-bottom: 0.75pt solid #8c877e;
  break-inside: avoid;
  page-break-inside: avoid;
}
.er-print .er-picture {
  flex: 0 0 30mm;
  width: 30mm;
  height: 30mm;
  object-fit: contain;
  background: #ffffff;
  border-radius: 1pt;
}
.er-print .er-text { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 20pt; }
.er-print .er-marker { display: block; margin-top: 1mm; font-size: 16pt; font-weight: 700; color: #a0001c; }
.er-print .er-footer {
  margin-top: 8mm;
  padding-top: 4mm;
  border-top: 0.75pt solid #8c877e;
  font-size: 16pt;
  break-inside: avoid;
  page-break-inside: avoid;
}
.er-print .er-footer p { margin: 0; }
.er-print .er-footer a { color: inherit; }
@media screen {
  .er-print {
    padding: 15mm;
    border: 1px solid #8c877e;
    border-radius: 4px;
  }
}
@media print {
  .er-screen-only { display: none !important; }
}
`;
