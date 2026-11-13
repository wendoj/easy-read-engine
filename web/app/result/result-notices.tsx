import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RECORDED_CHECKS_NOTE, type SampleInfo, recordedLabel } from "@/src/samples/sample";
import { ARASAAC_ATTRIBUTION_PARTS } from "@/src/symbols/attribution";

/** The simplified-version notice. No close button, by design. */
export function SafetyNotice({ text }: { text: string }) {
  return (
    <Alert role="note" className="border-2 border-primary bg-accent-tint">
      <Info aria-hidden strokeWidth={2} absoluteStrokeWidth />
      <AlertDescription className="text-lg font-semibold text-foreground">{text}</AlertDescription>
    </Alert>
  );
}

export function SampleLabel({ sample }: { sample: SampleInfo }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">{recordedLabel(sample)}</p>
      <p className="text-lg text-muted-foreground">{RECORDED_CHECKS_NOTE}</p>
    </div>
  );
}

/** Worded as in checker/data/LICENSE-pictograms.md. */
function SymbolAttribution() {
  return (
    <p className="text-lg text-muted-foreground">
      {ARASAAC_ATTRIBUTION_PARTS.map((part) =>
        part.href ? (
          <a
            key={part.text}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link underline underline-offset-4 hover:decoration-2"
          >
            {part.text}
          </a>
        ) : (
          <span key={part.text}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export function ResultFooter() {
  return (
    <footer className="border-t border-border pt-6">
      <SymbolAttribution />
    </footer>
  );
}
