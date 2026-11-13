import { useState } from "react";
import { EXPORT_FILENAME } from "@/src/export/errors";
import type { ConversionResult } from "@/src/pipeline/types";
import { exportPdf } from "@/src/ui/api";
import { canExport } from "@/src/ui/blocked-state";
import { saveBlob } from "@/src/ui/save-blob";

/** The server checks P1 again before it makes the PDF. */
export function usePdfExport(result: ConversionResult | null) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const onExport = async () => {
    if (result === null || !canExport(result) || exporting) return;
    setExporting(true);
    setExportError(null);
    const outcome = await exportPdf(result);
    setExporting(false);
    if (outcome.ok) saveBlob(outcome.pdf, EXPORT_FILENAME);
    else if (!outcome.aborted) setExportError(outcome.message);
  };

  return { exporting, exportError, clearExportError: () => setExportError(null), onExport };
}
