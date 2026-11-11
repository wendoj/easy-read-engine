/**
 * The print layout in React, for the `/print` preview. It renders the same
 * `PrintDocument`, class names and `PRINT_CSS` as the PDF export's static
 * HTML (`src/export/print-html.ts`), so the preview matches the PDF.
 * The PDF inlines pictures as data URIs; the preview loads `/symbols/<id>`.
 */
import Image from "next/image";
import { PRINT_CSS, type PrintDocument, failedChecksText } from "@/src/export/print-document";
import { symbolSrc } from "@/src/ui/result-layout";

/** 30mm at 96 dpi. CSS sets the printed size. */
const PICTURE_PX = 113;

export function PrintSheet({ doc }: { doc: PrintDocument }) {
  return (
    <>
      <style>{PRINT_CSS}</style>
      <main className="er-print">
        <h1 className="er-title">{doc.title}</h1>
        <p className="er-notice" role="note">
          {doc.notice}
        </p>
        <div className="er-checks">
          <p>{doc.passLabel}</p>
          {doc.failedChecks.length > 0 && <p>{failedChecksText(doc.failedChecks)}</p>}
        </div>
        <ul className="er-lines">
          {doc.rows.map((row) => (
            <li key={row.id} className="er-row">
              {row.symbolId === null ? (
                <div className="er-picture" aria-hidden />
              ) : (
                <Image
                  className="er-picture"
                  src={symbolSrc(row.symbolId)}
                  alt=""
                  width={PICTURE_PX}
                  height={PICTURE_PX}
                  unoptimized
                />
              )}
              <p className="er-text">
                {row.text}
                {row.marker !== null && <span className="er-marker">{row.marker}</span>}
              </p>
            </li>
          ))}
        </ul>
        <footer className="er-footer">
          <p>{doc.attribution.map((part) => part.text).join("")}</p>
        </footer>
      </main>
    </>
  );
}
