"use client";
/**
 * Paste or upload, then an editable confirm step. Without judge access the
 * paste, upload and convert controls are off and the sample letters move up.
 */
import { useId } from "react";
import type { SampleInfo } from "@/src/samples/sample";
import { isLocked } from "@/src/ui/access-lock";
import { AccessNotice } from "./_input/access-notice";
import { ConfirmStep } from "./_input/confirm-step";
import { EnterStep } from "./_input/enter-step";
import { useInputFlow } from "./_input/use-input-flow";

export { OUTSIDE_AI_NOTICE } from "./_input/panel-parts";

export function InputScreen({ samples = [] }: { samples?: readonly SampleInfo[] }) {
  const flow = useInputFlow();
  const ids = useId();
  const { access, setAccess, setError } = flow;

  const accessNotice =
    isLocked(access) ? (
      <AccessNotice
        access={access}
        onAccess={(next) => {
          setAccess(next);
          setError(null);
        }}
      />
    ) : null;

  // The steps swap at once, with no animation.
  if (flow.step === "confirm") {
    return (
      <ConfirmStep
        flow={flow}
        ids={{ confirm: `${ids}-confirm`, confirmCount: `${ids}-confirm-count` }}
        accessNotice={accessNotice}
      />
    );
  }
  return (
    <EnterStep
      flow={flow}
      ids={{ paste: `${ids}-paste`, pasteCount: `${ids}-paste-count`, file: `${ids}-file` }}
      samples={samples}
      accessNotice={accessNotice}
    />
  );
}
