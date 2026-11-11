"use client";

/**
 * Input screen (R1.1 to R1.7, R7.5): paste or upload, then an editable
 * confirm step. The text in the confirm box when the user selects Convert is
 * the Original for every later step (R1.6). It is sent as typed, never trimmed
 * or changed.
 *
 * Letter text stays in React state only (R7.4). The result goes to the
 * `ConversionProvider` in the root layout, and the result screen reads it with
 * `useConversion()`.
 *
 * "Try a sample letter" (task 29) loads a recorded result for a public sample
 * letter through `/api/sample`, which re-runs P1 to P8 and makes no model
 * call. The list holds only IDs and labels; the page passes it in from the
 * server.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ProgressEvent } from "@/src/pipeline/types";
import type { SampleInfo } from "@/src/samples/sample";
import { convertLetter, extractText, loadSample } from "@/src/ui/api";
import { useConversion } from "@/src/ui/conversion-context";
import { progressLabel, progressValue } from "@/src/ui/convert-events";
import { wordLimitState } from "@/src/ui/word-limit";

const ACCEPTED_FILES = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

export const OUTSIDE_AI_NOTICE =
  "Your letter text is sent to an outside AI service, so don't upload letters with personal details.";

type Step = "enter" | "confirm";
type Busy = null | "reading" | "converting" | "sample";

function OutsideAiNotice() {
  return (
    <Alert role="note">
      <AlertDescription className="text-base text-foreground">{OUTSIDE_AI_NOTICE}</AlertDescription>
    </Alert>
  );
}

/** `role="alert"` by default. The word-limit message uses "status", so it isn't read out on every keystroke. */
function ErrorAlert({ message, role = "alert" }: { message: string | null; role?: "alert" | "status" }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role={role}>
      <AlertDescription className="text-base text-destructive">{message}</AlertDescription>
    </Alert>
  );
}

function WordCount({ text, id }: { text: string; id: string }) {
  const state = wordLimitState(text);
  return (
    <Badge id={id} variant={state.overLimit ? "destructive" : "secondary"} className="h-7 px-3 text-sm">
      {state.label}
    </Badge>
  );
}

function SamplePicker({
  samples,
  busy,
  disabled,
  onShow,
}: {
  samples: readonly SampleInfo[];
  busy: boolean;
  disabled: boolean;
  onShow: (id: string) => void;
}) {
  const ids = useId();
  const [choice, setChoice] = useState<string>("");
  if (samples.length === 0) return null;
  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3 border-t pt-6">
      <h2 id={`${ids}-heading`} className="text-2xl font-semibold">
        Try a sample letter
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={choice} onValueChange={setChoice} disabled={disabled}>
          <SelectTrigger aria-label="Sample letter" className="h-11! min-w-72 px-4 text-base">
            <SelectValue placeholder="Choose a sample letter" />
          </SelectTrigger>
          <SelectContent>
            {samples.map((s) => (
              <SelectItem key={s.id} value={s.id} className="py-2 text-base">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="h-11 px-6 text-base"
          disabled={choice === "" || disabled}
          aria-busy={busy || undefined}
          onClick={() => onShow(choice)}
        >
          {busy ? "Loading" : "Show sample"}
        </Button>
      </div>
      <p aria-live="polite" role="status" className="font-medium empty:hidden">
        {busy ? "Checking the sample letter" : ""}
      </p>
    </section>
  );
}

export function InputScreen({ samples = [] }: { samples?: readonly SampleInfo[] }) {
  const router = useRouter();
  const { startResult } = useConversion();
  const ids = useId();
  const pasteId = `${ids}-paste`;
  const pasteCountId = `${ids}-paste-count`;
  const fileId = `${ids}-file`;
  const confirmId = `${ids}-confirm`;
  const confirmCountId = `${ids}-confirm-count`;

  const [step, setStep] = useState<Step>("enter");
  const [tab, setTab] = useState("paste");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);

  // Stop a running request when the screen is hidden or unmounted.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Move focus to the confirm step so keyboard and screen reader users land on it.
  useEffect(() => {
    if (step === "confirm") confirmHeadingRef.current?.focus();
  }, [step]);

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

  async function readFile() {
    if (!file) return;
    setError(null);
    setBusy("reading");
    const outcome = await extractText(file, { signal: startRequest() });
    setBusy(null);
    if (outcome.ok) goToConfirm(outcome.text);
    else if (!outcome.aborted) setError(outcome.message);
  }

  async function convert() {
    if (!limit.canConvert) return;
    setError(null);
    setProgress(null);
    setBusy("converting");
    const outcome = await convertLetter(text, { signal: startRequest(), onProgress: setProgress });
    setBusy(null);
    setProgress(null);
    if (outcome.ok) {
      startResult(outcome.result, null);
      router.push("/result");
    } else if (!outcome.aborted) {
      setError(outcome.message);
    }
  }

  async function showSample(id: string) {
    setError(null);
    setBusy("sample");
    const outcome = await loadSample(id, { signal: startRequest() });
    setBusy(null);
    if (outcome.ok) {
      startResult(outcome.result, outcome.sample);
      router.push("/result");
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
    setBusy(null);
  }

  if (step === "confirm") {
    const converting = busy === "converting";
    return (
      <section aria-labelledby={`${confirmId}-heading`} className="flex flex-col gap-5">
        <h2
          id={`${confirmId}-heading`}
          ref={confirmHeadingRef}
          tabIndex={-1}
          className="text-2xl font-semibold outline-none"
        >
          Check the letter text
        </h2>
        <p>Correct any mistakes before you convert.</p>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={confirmId} className="font-medium">
              Letter text
            </label>
            <WordCount text={text} id={confirmCountId} />
          </div>
          <Textarea
            id={confirmId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            readOnly={converting}
            aria-describedby={confirmCountId}
            aria-invalid={limit.overLimit || undefined}
            spellCheck
            className="min-h-80 text-lg leading-relaxed md:text-lg"
          />
        </div>

        <ErrorAlert message={limit.message} role="status" />
        <ErrorAlert message={error} />

        <div className="flex flex-col gap-2">
          {/* Always mounted, so screen readers announce each new stage. */}
          <p aria-live="polite" role="status" className="font-medium empty:hidden">
            {converting ? (progress ? progressLabel(progress) : "Sending the letter") : ""}
          </p>
          {converting ? (
            <Progress value={progress ? progressValue(progress) : 2} aria-label="Conversion progress" className="h-2" />
          ) : null}
        </div>

        <OutsideAiNotice />

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            size="lg"
            className="h-11 px-6 text-base"
            onClick={convert}
            disabled={!limit.canConvert || converting}
            aria-busy={converting || undefined}
          >
            {converting ? "Converting" : "Convert"}
          </Button>
          <Button type="button" size="lg" variant="outline" className="h-11 px-6 text-base" onClick={startAgain}>
            Start again
          </Button>
        </div>
      </section>
    );
  }

  const reading = busy === "reading";
  const loadingSample = busy === "sample";
  return (
    <section className="flex flex-col gap-5">
      <OutsideAiNotice />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          setError(null);
        }}
      >
        <TabsList className="h-11! w-full sm:w-fit">
          <TabsTrigger value="paste" disabled={reading} className="px-4 text-base">
            Paste text
          </TabsTrigger>
          <TabsTrigger value="upload" disabled={reading} className="px-4 text-base">
            Upload a file
          </TabsTrigger>
        </TabsList>

        <TabsContent value="paste" className="flex flex-col gap-4 pt-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={pasteId} className="font-medium">
                Letter text
              </label>
              <WordCount text={pasted} id={pasteCountId} />
            </div>
            <Textarea
              id={pasteId}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              aria-describedby={pasteCountId}
              className="min-h-64 text-lg leading-relaxed md:text-lg"
            />
          </div>
          <div>
            <Button
              type="button"
              size="lg"
              className="h-11 px-6 text-base"
              onClick={() => goToConfirm(pasted)}
              disabled={pasted.trim() === ""}
            >
              Next
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="upload" className="flex flex-col gap-4 pt-3">
          <div className="flex flex-col gap-2">
            <label htmlFor={fileId} className="font-medium">
              PDF or photo of the letter
            </label>
            <Input
              id={fileId}
              type="file"
              accept={ACCEPTED_FILES}
              disabled={reading}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
              }}
              className="h-11 text-base"
            />
          </div>
          <p aria-live="polite" role="status" className="font-medium empty:hidden">
            {reading ? "Reading the file" : ""}
          </p>
          <div>
            <Button
              type="button"
              size="lg"
              className="h-11 px-6 text-base"
              onClick={readFile}
              disabled={!file || reading}
              aria-busy={reading || undefined}
            >
              {reading ? "Reading" : "Read the file"}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <ErrorAlert message={error} />

      <SamplePicker
        samples={samples}
        busy={loadingSample}
        disabled={busy !== null}
        onShow={(id) => void showSample(id)}
      />
    </section>
  );
}
