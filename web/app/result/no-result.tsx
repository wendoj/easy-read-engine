import { LoaderCircle } from "lucide-react";
import { ProblemIcon } from "@/components/status-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GONE_HEADING, GONE_MESSAGE, SAMPLE_LOADING_MESSAGE } from "@/src/ui/result-url";
import { SECTION_HEADING } from "./headings";
import { StartAgainLink } from "./start-again-link";

/** After a reload or in a new tab: a sample loads again from its URL ID; a user's letter is gone. */
export function NoResult({ sampleId, error }: { sampleId: string | null; error: string | null }) {
  if (sampleId !== null && error === null) {
    return (
      <p role="status" className="flex items-center gap-3 text-xl font-semibold">
        <LoaderCircle aria-hidden className="size-6 motion-safe:animate-spin" />
        {SAMPLE_LOADING_MESSAGE}
      </p>
    );
  }
  if (error !== null) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive" role="alert">
          <ProblemIcon />
          <AlertDescription className="text-lg text-destructive">{error}</AlertDescription>
        </Alert>
        <StartAgainLink />
      </div>
    );
  }
  return (
    <section
      aria-labelledby="gone-heading"
      className="flex max-w-[720px] flex-col gap-4 rounded-2xl border border-border bg-card p-6"
    >
      <h2 id="gone-heading" className={SECTION_HEADING}>
        {GONE_HEADING}
      </h2>
      <p className="text-xl leading-normal">{GONE_MESSAGE}</p>
      <StartAgainLink />
    </section>
  );
}
