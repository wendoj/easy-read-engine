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
 *
 * Live conversion needs the judge access key (`/api/access`). Without access,
 * the paste, upload and convert controls are disabled and the sample letters
 * move up, so visitors can still read them. Until the access state arrives,
 * the controls stay on: the server checks access on every model route anyway.
 */
import { ArrowRight, ClipboardPaste, FileUp, Info, KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Panel, PanelBar } from "@/components/composer";
import { StageList } from "@/components/stage-list";
import { Steps } from "@/components/steps";
import { ProblemIcon } from "@/components/status-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ACCESS_CLOSED_MESSAGE,
  ACCESS_REQUIRED_MESSAGE,
  type AccessState,
  MAX_ACCESS_KEY_CHARS,
} from "@/src/access/errors";
import type { ProgressEvent } from "@/src/pipeline/types";
import type { SampleInfo } from "@/src/samples/sample";
import { convertLetter, extractText, getAccess, loadSample, sendAccessKey } from "@/src/ui/api";
import { useConversion } from "@/src/ui/conversion-context";
import { progressLabel, progressValue, stageRows } from "@/src/ui/convert-events";
import { statusFade } from "@/src/ui/motion";
import { resultHref } from "@/src/ui/result-url";
import { wordLimitState } from "@/src/ui/word-limit";
import { cn } from "cn";

const ACCEPTED_FILES = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

export const OUTSIDE_AI_NOTICE =
  "Your letter text is sent to an outside AI service, so don't upload letters with personal details.";

/** R7.5: right before the button that sends the letter out. No close button, by design. */
function OutsideAiNotice() {
  return (
    <Alert role="note" className="border-input bg-accent-tint">
      <Info aria-hidden strokeWidth={2} absoluteStrokeWidth />
      <AlertDescription className="text-lg leading-normal text-foreground">{OUTSIDE_AI_NOTICE}</AlertDescription>
    </Alert>
  );
}

/** The bottom of a panel: the outside-AI notice, then the buttons under it. */
function SendBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-5 sm:px-6">
      <OutsideAiNotice />
      <div className="flex flex-wrap justify-end gap-3">{children}</div>
    </div>
  );
}

type Step = "enter" | "confirm";

/**
 * The letter field inside a panel: no box of its own, the panel is the
 * boundary. `er-panel-field` drops the focus ring (globals.css): the blinking
 * cursor in the box shows where typing goes.
 */
const PANEL_FIELD =
  "er-panel-field min-h-72 resize-y rounded-none border-0 bg-transparent px-4 py-4 text-lg leading-normal sm:px-6";

type Busy = null | "reading" | "converting" | "sample";

/** `role="alert"` by default. The word-limit message uses "status", so it isn't read out on every keystroke. */
function ErrorAlert({ message, role = "alert" }: { message: string | null; role?: "alert" | "status" }) {
  const reduce = useReducedMotion() ?? false;
  if (!message) return null;
  // Fades in when it appears (not under reduced motion) and is removed at once. The icon and text carry the meaning.
  return (
    <motion.div {...statusFade(reduce)}>
      <Alert variant="destructive" role={role}>
        <ProblemIcon />
        <AlertDescription className="text-lg text-destructive">{message}</AlertDescription>
      </Alert>
    </motion.div>
  );
}

/** For example "120 of 1,500 words". Over the limit it turns red and gets the problem icon. */
function WordCount({ text, id }: { text: string; id: string }) {
  const state = wordLimitState(text);
  return (
    <span
      id={id}
      className={cn(
        "inline-flex items-center gap-1.5 text-lg tabular-nums",
        state.overLimit ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state.overLimit && <ProblemIcon className="size-5" />}
      {state.label}
    </span>
  );
}

/** One button per sample letter, one click to load it. */
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
      <h2 id={`${ids}-heading`} className="text-[22px] leading-tight font-semibold">
        Try a sample letter
      </h2>
      <p className="text-lg">See how a real public letter looks in Easy Read. No letter is sent to the AI service.</p>
      <ul className="flex flex-wrap gap-3">
        {samples.map((s) => {
          const loading = loadingId === s.id;
          return (
            <li key={s.id}>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                aria-busy={loading || undefined}
                onClick={() => onShow(s.id)}
              >
                {loading && <LoaderCircle aria-hidden className="motion-safe:animate-spin" />}
                <span className="whitespace-normal text-left">{loading ? "Loading" : s.label}</span>
              </Button>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" role="status" className="text-lg font-semibold empty:hidden">
        {loadingId !== null ? "Checking the sample letter" : ""}
      </p>
    </section>
  );
}

/**
 * Shown when this browser has no judge access. Samples stay usable. "denied"
 * offers the key field; "closed" (production with no key set) does not, as
 * no key can work. The key goes to `/api/access` only and is cleared after.
 */
function AccessNotice({
  access,
  onAccess,
}: {
  access: "denied" | "closed";
  onAccess: (next: AccessState) => void;
}) {
  const ids = useId();
  const keyId = `${ids}-key`;
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusOnMount = useCallback((el: HTMLInputElement | null) => el?.focus(), []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (key === "" || sending) return;
    setSending(true);
    setError(null);
    const outcome = await sendAccessKey(key);
    setSending(false);
    if (outcome.ok) {
      setKey("");
      onAccess(outcome.access);
    } else if (!outcome.aborted) {
      setError(outcome.message);
    }
  }

  return (
    <section aria-label="Access" className="flex flex-col gap-4">
      <Alert role="note" className="border-input bg-accent-tint">
        <LockKeyhole aria-hidden strokeWidth={2} absoluteStrokeWidth />
        <AlertDescription className="text-lg leading-normal text-foreground">
          {access === "closed" ? ACCESS_CLOSED_MESSAGE : ACCESS_REQUIRED_MESSAGE}
        </AlertDescription>
      </Alert>
      {access === "denied" &&
        (asking ? (
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
            <label htmlFor={keyId} className="text-lg font-semibold">
              Access key
            </label>
            <div className="flex flex-wrap gap-3">
              <Input
                id={keyId}
                ref={focusOnMount}
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                maxLength={MAX_ACCESS_KEY_CHARS}
                aria-invalid={error !== null || undefined}
                className="h-12 max-w-md flex-1 bg-card px-4 text-lg md:text-lg"
              />
              <Button type="submit" disabled={key === "" || sending} aria-busy={sending || undefined}>
                {sending && <LoaderCircle aria-hidden data-icon="inline-start" className="motion-safe:animate-spin" />}
                {sending ? "Checking the key" : "Use this key"}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button type="button" variant="outline" onClick={() => setAsking(true)}>
              <KeyRound aria-hidden data-icon="inline-start" />I have an access key
            </Button>
          </div>
        ))}
      <ErrorAlert message={error} />
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
        "m-4 flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-input bg-card px-6 py-8 text-center sm:m-6",
        "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
        over && "border-primary bg-accent-tint",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <FileUp aria-hidden strokeWidth={2} absoluteStrokeWidth className="size-8 text-foreground" />
      <span className="text-xl font-semibold break-all">{file ? file.name : "Choose a photo or PDF of the letter"}</span>
      <span className="text-lg text-muted-foreground">{file ? "Choose a different file" : "Or drag it here"}</span>
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

  // Null until /api/access answers, or when it can't be reached.
  const [access, setAccess] = useState<AccessState | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Stop a running request when the screen is hidden or unmounted.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    void getAccess({ signal: controller.signal }).then((outcome) => {
      if (outcome.ok) setAccess(outcome.access);
    });
    return () => controller.abort();
  }, []);

  const locked = access === "denied" || access === "closed";
  const accessNotice =
    access === "denied" || access === "closed" ? (
      <AccessNotice
        access={access}
        onAccess={(next) => {
          setAccess(next);
          setError(null);
        }}
      />
    ) : null;

  // Move focus to the confirm step so keyboard and screen reader users land on it.
  // A ref callback, because the heading mounts with the step.
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
    if (!file || locked) return;
    setError(null);
    setBusy("reading");
    const outcome = await extractText(file, { signal: startRequest() });
    setBusy(null);
    if (outcome.ok) goToConfirm(outcome.text);
    else if (!outcome.aborted) failedWith(outcome);
  }

  /** Shows the error. An access error locks the controls instead, and the access notice says why. */
  function failedWith(outcome: { error: string | null; message: string }) {
    if (outcome.error === "access_required" || outcome.error === "access_closed") {
      setAccess(outcome.error === "access_required" ? "denied" : "closed");
      setError(null);
      return;
    }
    setError(outcome.message);
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
      // The sample ID goes in the URL, so a reload can load the sample again (src/ui/result-url.ts).
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

  function confirmView() {
    const converting = busy === "converting";
    return (
      <section aria-labelledby={`${confirmId}-heading`} className="flex flex-col gap-6">
        <Steps current={2} />
        {accessNotice}
        <Panel>
          <PanelBar>
            <h2
              id={`${confirmId}-heading`}
              ref={focusOnMount}
              tabIndex={-1}
              className="text-[26px] leading-tight font-semibold outline-none"
            >
              Check your letter
            </h2>
            <WordCount text={text} id={confirmCountId} />
          </PanelBar>
          <label htmlFor={confirmId} className="block px-4 pt-4 text-lg sm:px-6">
            Change any words that are wrong.
          </label>
          <Textarea
            id={confirmId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            readOnly={converting}
            aria-describedby={confirmCountId}
            aria-invalid={limit.overLimit || undefined}
            spellCheck
            className={PANEL_FIELD}
          />
          <SendBar>
            <Button type="button" variant="outline" onClick={startAgain}>
              Start again
            </Button>
            <Button
              type="button"
              onClick={convert}
              disabled={!limit.canConvert || converting || locked}
              aria-busy={converting || undefined}
            >
              {converting ? "Making it Easy Read" : "Make it Easy Read"}
              {!converting && <ArrowRight aria-hidden data-icon="inline-end" />}
            </Button>
          </SendBar>
        </Panel>

        <ErrorAlert message={limit.message} role="status" />
        <ErrorAlert message={error} />

        {/* Always mounted, so screen readers announce each new stage. The panel below shows the same thing. */}
        <p aria-live="polite" role="status" className="sr-only">
          {converting ? (progress ? progressLabel(progress) : "Sending the letter") : ""}
        </p>
        {converting ? (
          <Panel className="flex flex-col gap-5 p-5 sm:p-6">
            <p aria-hidden className="text-xl font-semibold">
              {progress ? progressLabel(progress) : "Sending the letter"}
            </p>
            <Progress value={progress ? progressValue(progress) : 2} aria-label="Conversion progress" />
            <StageList rows={stageRows(progress, sawFix)} />
          </Panel>
        ) : null}
      </section>
    );
  }

  function enterView() {
    const reading = busy === "reading";
    // Visitors without access see the samples first, as they are what they can use.
    const sampleChips = (
      <SampleChips
        samples={samples}
        loadingId={sampleId}
        disabled={busy !== null}
        onShow={(id) => void showSample(id)}
      />
    );
    return (
      <section className="flex flex-col gap-6" aria-label="Your letter">
        <Steps current={1} />
        {accessNotice}
        {locked && sampleChips}
        <Panel>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value);
              setError(null);
            }}
            className="gap-0"
          >
            <PanelBar>
              <TabsList className="h-14! w-full sm:w-fit" aria-label="How to add your letter">
                <TabsTrigger value="paste" disabled={reading} className="px-5">
                  <ClipboardPaste aria-hidden strokeWidth={2} absoluteStrokeWidth />
                  Paste text
                </TabsTrigger>
                <TabsTrigger value="upload" disabled={reading} className="px-5">
                  <FileUp aria-hidden strokeWidth={2} absoluteStrokeWidth />
                  Photo or PDF
                </TabsTrigger>
              </TabsList>
              {tab === "paste" && <WordCount text={pasted} id={pasteCountId} />}
            </PanelBar>

            <TabsContent value="paste" className="text-lg">
              <label htmlFor={pasteId} className="block px-4 pt-4 text-lg font-semibold sm:px-6">
                Letter text
              </label>
              <Textarea
                id={pasteId}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                aria-describedby={pasteCountId}
                placeholder="Paste your letter here"
                disabled={locked}
                className={PANEL_FIELD}
              />
              <SendBar>
                <Button type="button" onClick={() => goToConfirm(pasted)} disabled={pasted.trim() === "" || locked}>
                  Next
                  <ArrowRight aria-hidden data-icon="inline-end" />
                </Button>
              </SendBar>
            </TabsContent>

            <TabsContent value="upload" className="text-lg">
              <FileDrop
                id={fileId}
                file={file}
                disabled={reading || locked}
                onFile={(next) => {
                  setFile(next);
                  setError(null);
                }}
              />
              <p aria-live="polite" role="status" className="px-6 pb-3 text-lg font-semibold empty:hidden">
                {reading ? "Reading the file" : ""}
              </p>
              <SendBar>
                <Button type="button" onClick={readFile} disabled={!file || reading || locked} aria-busy={reading || undefined}>
                  {reading && <LoaderCircle aria-hidden data-icon="inline-start" className="motion-safe:animate-spin" />}
                  {reading ? "Reading the letter" : "Read the letter"}
                </Button>
              </SendBar>
            </TabsContent>
          </Tabs>
        </Panel>

        <ErrorAlert message={error} />

        {!locked && sampleChips}
      </section>
    );
  }

  // The enter and confirm steps swap at once, with no animation.
  return step === "confirm" ? confirmView() : enterView();
}
