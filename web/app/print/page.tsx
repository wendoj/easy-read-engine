import { PrintView } from "./print-view";

/** The result lives in client state only, so `PrintView` does the work. `/api/export` renders the PDF itself. */
export default function PrintPage() {
  return <PrintView />;
}
