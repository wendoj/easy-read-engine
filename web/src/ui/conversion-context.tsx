"use client";

/**
 * Hands the conversion result from the input screen to the result screen.
 *
 * The result holds the letter text, so it lives only in React state in this
 * provider, which wraps the app in the root layout. It is never written to
 * localStorage, sessionStorage, cookies, the URL or the server (R7.4). A
 * client navigation keeps it; a reload or a new tab loses it, and the result
 * screen then sends the user back to the input screen.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ConversionResult } from "@/src/pipeline/types";

export interface ConversionContextValue {
  /** The latest result, or null before a conversion or after `clearResult`. */
  result: ConversionResult | null;
  setResult: (result: ConversionResult) => void;
  clearResult: () => void;
}

const ConversionContext = createContext<ConversionContextValue | null>(null);

export function ConversionProvider({ children }: { children: React.ReactNode }) {
  const [result, setResultState] = useState<ConversionResult | null>(null);
  const setResult = useCallback((next: ConversionResult) => setResultState(next), []);
  const clearResult = useCallback(() => setResultState(null), []);
  const value = useMemo(() => ({ result, setResult, clearResult }), [result, setResult, clearResult]);
  return <ConversionContext.Provider value={value}>{children}</ConversionContext.Provider>;
}

export function useConversion(): ConversionContextValue {
  const value = useContext(ConversionContext);
  if (value === null) throw new Error("useConversion must be used inside ConversionProvider.");
  return value;
}
