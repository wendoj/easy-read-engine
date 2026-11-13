"use client";
/** The print layout for the result on screen. A blocked result has no lines and shows no layout. */
import Link from "next/link";
import { useMemo } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { printDocument } from "@/src/export/print-document";
import { canExport } from "@/src/ui/blocked-state";
import { useConversion } from "@/src/ui/conversion-context";
import { GONE_HEADING, GONE_MESSAGE, resultHref } from "@/src/ui/result-url";
import { useConfirmUnload } from "@/src/ui/use-confirm-unload";
import { StartAgainLink } from "../result/start-again-link";
import { PrintSheet } from "./print-sheet";

export function PrintView() {
  const { result, sample } = useConversion();
  const doc = useMemo(() => (result && canExport(result) ? printDocument(result) : null), [result]);

  useConfirmUnload(result !== null && sample === null);

  if (doc === null) {
    return (
      <main className="flex w-full max-w-[720px] flex-col gap-4 px-4 pt-14 pb-24">
        <h1 className="text-[28px] leading-tight font-semibold">{GONE_HEADING}</h1>
        <p className="text-xl leading-normal">{GONE_MESSAGE}</p>
        <StartAgainLink />
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
