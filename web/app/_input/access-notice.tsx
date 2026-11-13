"use client";
import { KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ACCESS_CLOSED_MESSAGE,
  ACCESS_REQUIRED_MESSAGE,
  type AccessState,
  MAX_ACCESS_KEY_CHARS,
} from "@/src/access/errors";
import { sendAccessKey } from "@/src/ui/api";
import { ErrorAlert } from "./panel-parts";

/**
 * "closed" (production with no key set) offers no key field, as no key can
 * work. The key goes to `/api/access` only and is cleared after.
 */
export function AccessNotice({
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
