"use client";

/**
 * Hands the conversion result from the input screen to the result screen.
 *
 * The result holds the letter text, so it lives only in React state in this
 * provider, which wraps the app in the root layout. It is never written to
 * localStorage, sessionStorage, cookies, the URL or the server (R7.4). A
 * client navigation keeps it; a reload or a new tab loses it. The result
 * screen then loads a public sample again from its ID in the URL, or says the
 * user's letter is gone (src/ui/result-url.ts).
 *
 * `sample` is set when the result came from a recorded sample letter (task
 * 29), so the result screen can show when and with which model it was
 * recorded. `setResult` keeps it (edits to a sample are still that sample);
 * `startResult` replaces both, for a new conversion or a newly loaded sample.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ConversionResult } from "@/src/pipeline/types";
import type { SampleInfo } from "@/src/samples/sample";

export interface ConversionContextValue {
  /** The latest result, or null before a conversion or after `clearResult`. */
  result: ConversionResult | null;
  /** The recorded sample the result came from, or null for the user's own letter. */
  sample: SampleInfo | null;
  /** Replaces the result and keeps `sample`. Used after an edit or an undo. */
  setResult: (result: ConversionResult) => void;
  /** A new result: from a conversion (`sample` null) or a loaded sample. */
  startResult: (result: ConversionResult, sample: SampleInfo | null) => void;
  clearResult: () => void;
}

const ConversionContext = createContext<ConversionContextValue | null>(null);

export function ConversionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ result: ConversionResult | null; sample: SampleInfo | null }>({
    result: null,
    sample: null,
  });
  const setResult = useCallback((next: ConversionResult) => setState((s) => ({ ...s, result: next })), []);
  const startResult = useCallback(
    (next: ConversionResult, sample: SampleInfo | null) => setState({ result: next, sample }),
    [],
  );
  const clearResult = useCallback(() => setState({ result: null, sample: null }), []);
  const value = useMemo(
    () => ({ result: state.result, sample: state.sample, setResult, startResult, clearResult }),
    [state, setResult, startResult, clearResult],
  );
  return <ConversionContext.Provider value={value}>{children}</ConversionContext.Provider>;
}

export function useConversion(): ConversionContextValue {
  const value = useContext(ConversionContext);
  if (value === null) throw new Error("useConversion must be used inside ConversionProvider.");
  return value;
}
