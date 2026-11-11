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
import { ArrowRight, FileUp, Info, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Window, WindowBar } from "@/components/composer";
import { StageList } from "@/components/stage-list";
import { ProblemIcon } from "@/components/status-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ProgressEvent } from "@/src/pipeline/types";
import type { SampleInfo } from "@/src/samples/sample";
import { convertLetter, extractText, loadSample } from "@/src/ui/api";
import { useConversion } from "@/src/ui/conversion-context";
import { progressLabel, progressValue, stageRows } from "@/src/ui/convert-events";
import { STAGGER, STATUS_FADE, enterVariants, exitVariant } from "@/src/ui/motion";
import { wordLimitState } from "@/src/ui/word-limit";
import { cn } from "cn";

const ACCEPTED_FILES = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

export const OUTSIDE_AI_NOTICE =
  "Your letter text is sent to an outside AI service, so don't upload letters with personal details.";

/** R7.5, in the window's bottom bar, next to the action that sends the letter. */
function OutsideAiNotice() {
  return (
    <p role="note" className="flex max-w-[460px] items-start gap-2 text-[15px] leading-[1.4] text-muted-foreground">
      <Info aria-hidden strokeWidth={1.5} absoluteStrokeWidth className="mt-0.5 size-4 shrink-0" />
      <span>{OUTSIDE_AI_NOTICE}</span>
    </p>
  );
}

type Step = "enter" | "confirm";

/** The letter field inside the product window: no box of its own, the window is the boundary. */
const WINDOW_FIELD =
  "min-h-72 resize-none rounded-none border-0 bg-transparent px-4 py-4 text-lg leading-relaxed sm:px-5";

type Busy = null | "reading" | "converting" | "sample";

/** `role="alert"` by default. The word-limit message uses "status", so it isn't read out on every keystroke. */
function ErrorAlert({ message, role = "alert" }: { message: string | null; role?: "alert" | "status" }) {
  if (!message) return null;
  // Fades in when it appears and is removed at once. The icon and text carry the meaning.
  return (
    <motion.div initial={STATUS_FADE.initial} animate={STATUS_FADE.animate} transition={STATUS_FADE.transition}>
      <Alert variant="destructive" role={role}>
        <ProblemIcon />
        <AlertDescription className="text-base text-destructive">{message}</AlertDescription>
      </Alert>
    </motion.div>
  );
}

/** Mono label, e.g. "0 OF 1,500 WORDS". Over the limit it turns red and gets the problem icon. */
function WordCount({ text, id }: { text: string; id: string }) {
  const state = wordLimitState(text);
  return (
    <span
      id={id}
      className={cn(
        "label-mono inline-flex items-center gap-1.5",
        state.overLimit ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state.overLimit && <ProblemIcon className="size-4" />}
      {state.label}
    </span>
  );
}

/** One pill chip per sample, one click to load (Devin's prompt suggestions). */
function SampleChips({
  samples,
  loadingId,
  disabled,
  onShow,
}: {
  samples: readonly SampleInfo[];
  loadingId: string | null;
  disabled: boolean;
  onShow: (id: string) => void;
}) {
  const ids = useId();
  if (samples.length === 0) return null;
  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3">
      <h2 id={`${ids}-heading`} className="label-mono text-muted-foreground">
        Try a sample letter
      </h2>
      <ul className="flex flex-wrap gap-2">
        {samples.map((s) => {
          const loading = loadingId === s.id;
          return (
            <li key={s.id}>
              <Button
                type="button"
                variant="tint"
                size="sm"
                disabled={disabled}
                aria-busy={loading || undefined}
                onClick={() => onShow(s.id)}
              >
                {loading && <LoaderCircle aria-hidden className="motion-safe:animate-spin" />}
                {loading ? "Loading" : s.label}
              </Button>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" role="status" className="text-base font-medium empty:hidden">
        {loadingId !== null ? "Checking the sample letter" : ""}
      </p>
    </section>
  );
}

/** The file field inside the composer: a dashed drop area over a visually hidden input. */
function FileDrop({
  id,
  file,
  disabled,
  onFile,
}: {
  id: string;
  file: File | null;
  disabled: boolean;
  onFile: (file: File | null) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFile(e.dataTransfer.files?.[0] ?? null);
      }}
      className={cn(
        "m-4 flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-input bg-card px-6 py-8 text-center transition-[background-color,border-color] duration-150 sm:m-5",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground",
        over && "border-accent-blue bg-accent-tint",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <FileUp aria-hidden strokeWidth={1.5} absoluteStrokeWidth className="size-7 text-muted-foreground" />
      <span className="text-lg">{file ? file.name : "Choose a PDF or a photo of the letter"}</span>
      <span className="text-base text-muted-foreground">{file ? "Choose a different file" : "Or drop it here"}</span>
      <input
        id={id}
        type="file"
        accept={ACCEPTED_FILES}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export function InputScreen({ samples = [] }: { samples?: readonly SampleInfo[] }) {
  const router = useRouter();
  const { startResult } = useConversion();
  const reduceMotion = useReducedMotion() ?? false;
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
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [sawFix, setSawFix] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Stop a running request when the screen is hidden or unmounted.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Move focus to the confirm step so keyboard and screen reader users land on it.
  // A ref callback, because the step mounts only after the input step's exit.
  const focusOnMount = useCallback((el: HTMLHeadingElement | null) => el?.focus(), []);

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
      setError(outcome.message);
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
    setSawFix(false);
    setBusy(null);
    setSampleId(null);
  }

  const chunk = enterVariants(reduceMotion);
  const exit = exitVariant(reduceMotion);

  function confirmView() {
    const converting = busy === "converting";
    // Staged entrance when the confirm step appears: window, then status.
    // It only ever mounts after a user action, so the server HTML is never hidden.
    return (
      <motion.section
        key="confirm"
        aria-labelledby={`${confirmId}-heading`}
        className="flex flex-col gap-4"
        initial="hidden"
        animate="visible"
        exit={exit}
        variants={STAGGER}
      >
        <motion.div variants={chunk}>
          <Window>
            <WindowBar>
              <h2
                id={`${confirmId}-heading`}
                ref={focusOnMount}
                tabIndex={-1}
                className="text-lg font-normal tracking-[-0.01em] outline-none"
              >
                Check the letter text and correct any mistakes
              </h2>
              <WordCount text={text} id={confirmCountId} />
            </WindowBar>
            <label htmlFor={confirmId} className="sr-only">
              Letter text
            </label>
            <Textarea
              id={confirmId}
              value={text}
              onChange={(event) => setText(event.target.value)}
              readOnly={converting}
              aria-describedby={confirmCountId}
              aria-invalid={limit.overLimit || undefined}
              spellCheck
              className={WINDOW_FIELD}
            />
            <WindowBar position="bottom">
              <OutsideAiNotice />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" onClick={startAgain}>
                  Start again
                </Button>
                <Button
                  type="button"
                  onClick={convert}
                  disabled={!limit.canConvert || converting}
                  aria-busy={converting || undefined}
                >
                  {converting ? "Converting" : "Convert"}
                  {!converting && <ArrowRight aria-hidden data-icon="inline-end" />}
                </Button>
              </div>
            </WindowBar>
          </Window>
        </motion.div>

        <ErrorAlert message={limit.message} role="status" />
        <ErrorAlert message={error} />

        {/* Always mounted, so screen readers announce each new stage. The list below shows the same thing. */}
        <p aria-live="polite" role="status" className="sr-only">
          {converting ? (progress ? progressLabel(progress) : "Sending the letter") : ""}
        </p>
        {converting ? (
          <motion.div
            initial={STATUS_FADE.initial}
            animate={STATUS_FADE.animate}
            transition={STATUS_FADE.transition}
          >
            <Window className="flex flex-col gap-5 p-5">
              <StageList rows={stageRows(progress, sawFix)} />
              <Progress value={progress ? progressValue(progress) : 2} aria-label="Conversion progress" />
            </Window>
          </motion.div>
        ) : null}
      </motion.section>
    );
  }

  function enterView() {
    const reading = busy === "reading";
    return (
      <motion.section
        key="enter"
        className="flex flex-col gap-4"
        initial="hidden"
        animate="visible"
        exit={exit}
        variants={chunk}
      >
        <Window>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value);
              setError(null);
            }}
            className="gap-0"
          >
            <WindowBar className="py-2.5">
              <TabsList className="h-11! w-full sm:w-fit">
                <TabsTrigger value="paste" disabled={reading}>
                  Paste text
                </TabsTrigger>
                <TabsTrigger value="upload" disabled={reading}>
                  Upload a file
                </TabsTrigger>
              </TabsList>
              {tab === "paste" && <WordCount text={pasted} id={pasteCountId} />}
            </WindowBar>

            <TabsContent value="paste" className="text-lg">
              <label htmlFor={pasteId} className="sr-only">
                Letter text
              </label>
              <Textarea
                id={pasteId}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                aria-describedby={pasteCountId}
                placeholder="Paste the letter here"
                className={WINDOW_FIELD}
              />
              <WindowBar position="bottom">
                <OutsideAiNotice />
                <Button type="button" onClick={() => goToConfirm(pasted)} disabled={pasted.trim() === ""}>
                  Next
                  <ArrowRight aria-hidden data-icon="inline-end" />
                </Button>
              </WindowBar>
            </TabsContent>

            <TabsContent value="upload" className="text-lg">
              <FileDrop
                id={fileId}
                file={file}
                disabled={reading}
                onFile={(next) => {
                  setFile(next);
                  setError(null);
                }}
              />
              <p aria-live="polite" role="status" className="px-5 pb-3 text-base font-medium empty:hidden">
                {reading ? "Reading the file" : ""}
              </p>
              <WindowBar position="bottom">
                <OutsideAiNotice />
                <Button type="button" onClick={readFile} disabled={!file || reading} aria-busy={reading || undefined}>
                  {reading && <LoaderCircle aria-hidden data-icon="inline-start" className="motion-safe:animate-spin" />}
                  {reading ? "Reading" : "Read the file"}
                </Button>
              </WindowBar>
            </TabsContent>
          </Tabs>
        </Window>

        <ErrorAlert message={error} />

        <SampleChips
          samples={samples}
          loadingId={sampleId}
          disabled={busy !== null}
          onShow={(id) => void showSample(id)}
        />
      </motion.section>
    );
  }

  // Enter ⇄ confirm swap: the old view exits (150ms) before the new one enters.
  // initial={false}: the first render is left to the page's CSS entrance.
  return (
    <AnimatePresence mode="wait" initial={false}>
      {step === "confirm" ? confirmView() : enterView()}
    </AnimatePresence>
  );
}
