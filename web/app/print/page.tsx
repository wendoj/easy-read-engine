import { PrintView } from "./print-view";

/**
 * Print layout (task 28, R8): A4, text of 16pt or more, picture column on the
 * left, one line per row, the R7.1 notice at the top of page 1 and the
 * ARASAAC attribution in the footer. The result lives in client state only,
 * so `PrintView` does the work. `/api/export` renders the same layout to PDF
 * from the request body, not from this page.
 */
export default function PrintPage() {
  return <PrintView />;
}
