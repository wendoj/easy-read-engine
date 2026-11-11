"use client";
/**
 * `/print` preview (task 28): the print layout for the result on screen, so
 * it can be checked in a browser and printed from there. The result comes
 * from `useConversion()` and is never stored, so after a reload there is
 * nothing to show (R7.4); the page says so and offers "Start again". While a
 * user-letter result is shown, the browser asks before a reload, as on
 * `/result`. A blocked result has no lines and shows no layout
 * (R9.5).
 */
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { printDocument } from "@/src/export/print-document";
import { canExport } from "@/src/ui/blocked-state";
import { useConversion } from "@/src/ui/conversion-context";
import { GONE_HEADING, GONE_MESSAGE, resultHref } from "@/src/ui/result-url";
import { PrintSheet } from "./print-sheet";

export function PrintView() {
  const { result, sample } = useConversion();
  const doc = useMemo(() => (result && canExport(result) ? printDocument(result) : null), [result]);

  // The print view shows the user's own letter too, which can't come back after a reload.
  const userLetterShown = result !== null && sample === null;
  useEffect(() => {
    if (!userLetterShown) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [userLetterShown]);

  if (doc === null) {
    return (
      <main className="flex w-full max-w-[720px] flex-col gap-4 px-4 pt-14 pb-24">
        <h1 className="text-[28px] leading-tight font-semibold">{GONE_HEADING}</h1>
        <p className="text-xl leading-normal">{GONE_MESSAGE}</p>
        <Link href="/" className={buttonVariants({ className: "w-fit" })}>
          Start again
        </Link>
      </main>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 bg-wash px-4 pt-8 pb-16">
      <div className="er-screen-only mx-auto flex w-full max-w-[180mm] flex-wrap gap-3">
        <Button type="button" onClick={() => window.print()}>
          Print
        </Button>
        <Link href={resultHref(sample?.id ?? null)} className={buttonVariants({ variant: "outline" })}>
          Back to the Easy Read version
        </Link>
      </div>
      <PrintSheet doc={doc} />
    </div>
  );
}
