"use client";

/**
 * Hands the result from the input screen to the result screen. It holds
 * letter text, so it lives only in React state: never in storage, cookies,
 * the URL or the server.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ConversionResult } from "@/src/pipeline/types";
import type { SampleInfo } from "@/src/samples/sample";

export interface ConversionContextValue {
  result: ConversionResult | null;
  /** Null for the user's own letter. */
  sample: SampleInfo | null;
  /** Keeps `sample`: an edited sample is still that sample. */
  setResult: (result: ConversionResult) => void;
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
