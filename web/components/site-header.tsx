"use client";
/**
 * Top bar: mark and name, and a way back to the start on the result and
 * print screens. No other links: every screen has one job.
 * Not sticky, so it doesn't take space while reading a long result. Hidden
 * when printing.
 */
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { buttonVariants } from "@/components/ui/button";

/** The Easy Read mark: a letter with a folded corner and two short lines. Same shape as app/icon.svg. */
export function Mark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={className} fill="currentColor">
      <defs>
        <mask id={id}>
          <rect width="32" height="32" fill="#fff" />
          <path d="M18.5 1.5 H29.5 V12.5 Z" fill="#000" />
          <path
            d="M19.5 3.5 V9.5 a1.5 1.5 0 0 0 1.5 1.5 H27"
            fill="none"
            stroke="#000"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <rect x="9" y="16" width="14" height="3.25" rx="1.625" fill="#000" />
          <rect x="9" y="22" width="9" height="3.25" rx="1.625" fill="#000" />
        </mask>
      </defs>
      <rect x="5" y="3" width="22" height="26" rx="4" mask={`url(#${id})`} />
      <path d="M20.5 4 L26.5 10 H22 a1.5 1.5 0 0 1 -1.5 -1.5 Z" />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const away = pathname === "/result" || pathname === "/print";
  return (
    <header className="border-b border-border bg-card print:hidden">
      <div className="mx-auto flex min-h-[72px] w-full max-w-[1200px] items-center gap-6 px-4 py-3">
        <Link href="/" className="flex min-h-12 items-center gap-3 rounded-md text-[22px] font-semibold">
          <Mark className="size-8 text-primary" />
          Easy Read
        </Link>
        {away ? (
          <Link href="/" className={buttonVariants({ variant: "outline", className: "ml-auto" })}>
            <RotateCcw aria-hidden strokeWidth={1.5} absoluteStrokeWidth data-icon="inline-start" />
            New letter
          </Link>
        ) : null}
      </div>
    </header>
  );
}
