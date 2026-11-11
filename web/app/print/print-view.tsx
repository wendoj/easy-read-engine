"use client";
/**
 * `/print` preview (task 28): the print layout for the result on screen, so
 * it can be checked in a browser and printed from there. The result comes
 * from `useConversion()` and is never stored, so after a reload there is
 * nothing to show (R7.4). A blocked result has no lines and shows no layout
 * (R9.5).
 */
import Link from "next/link";
import { useMemo } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { printDocument } from "@/src/export/print-document";
import { canExport } from "@/src/ui/blocked-state";
import { useConversion } from "@/src/ui/conversion-context";
import { PrintSheet } from "./print-sheet";

export function PrintView() {
  const { result } = useConversion();
  const doc = useMemo(() => (result && canExport(result) ? printDocument(result) : null), [result]);

  if (doc === null) {
    return (
      <div className="flex w-full max-w-3xl flex-col gap-4 px-4 pt-14 pb-24 text-lg">
        <p>There is no Easy Read version to print. Letters aren&apos;t saved, so convert the letter again.</p>
        <Link href="/" className={buttonVariants({ variant: "outline", className: "w-fit" })}>
          Convert another letter
        </Link>
      </div>
    );
  }

  return (
    <div className="er-backdrop flex flex-1 flex-col gap-6 px-4 pt-8 pb-16">
      <div className="er-screen-only mx-auto flex w-full max-w-[180mm] flex-wrap gap-3">
        <Button type="button" onClick={() => window.print()}>
          Print
        </Button>
        <Link href="/result" className={buttonVariants({ variant: "outline" })}>
          Back to the Easy Read version
        </Link>
      </div>
      <PrintSheet doc={doc} />
    </div>
  );
}
