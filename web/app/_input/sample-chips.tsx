"use client";
import { LoaderCircle } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import type { SampleInfo } from "@/src/samples/sample";

export function SampleChips({
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
