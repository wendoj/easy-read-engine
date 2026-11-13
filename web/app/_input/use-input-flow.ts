import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ProgressEvent } from "@/src/pipeline/types";
import { accessAfterError, isLocked } from "@/src/ui/access-lock";
import { convertLetter, extractText, loadSample } from "@/src/ui/api";
import { useConversion } from "@/src/ui/conversion-context";
import { resultHref } from "@/src/ui/result-url";
import { useAccess } from "@/src/ui/use-access";
import { wordLimitState } from "@/src/ui/word-limit";

export type Step = "enter" | "confirm";
export type Busy = null | "reading" | "converting" | "sample";

/**
 * State and actions for the input screen. Letter text stays in React state
 * only. The confirmed text is sent as typed, never trimmed or changed.
 */
export function useInputFlow() {
  const router = useRouter();
  const { startResult } = useConversion();
  const [step, setStep] = useState<Step>("enter");
  const [tab, setTab] = useState("paste");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [sawFix, setSawFix] = useState(false);
  // While access is unknown the controls stay on: every model route checks access anyway.
  const [access, setAccess] = useAccess();
  const abortRef = useRef<AbortController | null>(null);

  // Stop a running request when the screen unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const locked = isLocked(access);
  const limit = wordLimitState(text);

  function startRequest(): AbortSignal {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
  }

  function goToConfirm(next: string) {
    setText(next);
    setError(null);
    setStep("confirm");
  }

  /** An access error locks the controls instead, and the access notice says why. */
  function failedWith(outcome: { error: string | null; message: string }) {
    const next = accessAfterError(outcome.error);
    if (next !== null) {
      setAccess(next);
      setError(null);
      return;
    }
    setError(outcome.message);
  }

  async function readFile() {
    if (!file || locked) return;
    setError(null);
    setBusy("reading");
    const outcome = await extractText(file, { signal: startRequest() });
    setBusy(null);
    if (outcome.ok) goToConfirm(outcome.text);
    else if (!outcome.aborted) failedWith(outcome);
  }

  async function convert() {
    if (!limit.canConvert || locked) return;
    setError(null);
    setProgress(null);
    setSawFix(false);
    setBusy("converting");
    const outcome = await convertLetter(text, {
      signal: startRequest(),
      onProgress: (event) => {
        setProgress(event);
        if (event.stage === "regenerating") setSawFix(true);
      },
    });
    setBusy(null);
    setProgress(null);
    if (outcome.ok) {
      startResult(outcome.result, null);
      router.push("/result");
    } else if (!outcome.aborted) {
      failedWith(outcome);
    }
  }

  async function showSample(id: string) {
    setError(null);
    setBusy("sample");
    setSampleId(id);
    const outcome = await loadSample(id, { signal: startRequest() });
    setBusy(null);
    setSampleId(null);
    if (outcome.ok) {
      startResult(outcome.result, outcome.sample);
      // The sample ID goes in the URL, so a reload can load it again.
      router.push(resultHref(outcome.sample.id));
    } else if (!outcome.aborted) {
      setError(outcome.message);
    }
  }

  function startAgain() {
    abortRef.current?.abort();
    setStep("enter");
    setText("");
    setPasted("");
    setFile(null);
    setError(null);
    setProgress(null);
    setSawFix(false);
    setBusy(null);
    setSampleId(null);
  }

  return {
    step,
    tab,
    setTab,
    pasted,
    setPasted,
    file,
    setFile,
    text,
    setText,
    busy,
    sampleId,
    error,
    setError,
    progress,
    sawFix,
    access,
    setAccess,
    locked,
    limit,
    goToConfirm,
    readFile,
    convert,
    showSample,
    startAgain,
  };
}

export type InputFlow = ReturnType<typeof useInputFlow>;
