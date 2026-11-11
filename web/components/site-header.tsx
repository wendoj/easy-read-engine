"use client";
/**
 * Top bar, after devin.ai: mark and wordmark, text links in pills, and a
 * black pill on the right. Not sticky, so it doesn't take space while reading
 * a long result. Hidden when printing.
 */
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

const NAV_LINK =
  "hidden rounded-full px-3 py-1.5 text-[15px] leading-[1.4] transition-[background-color] duration-150 hover:bg-tint sm:inline-flex";

export function SiteHeader() {
  const pathname = usePathname();
  const home = pathname === "/";
  return (
    <header className="print:hidden">
      {home && (
        <div className="mx-auto w-full max-w-[1160px] px-4 pt-2.5">
          <p className="er-banner rounded-md px-4 py-1.5 text-center text-[15px] leading-[1.4]">
            We never save your letter. Close the page and the text is gone.
          </p>
        </div>
      )}
      <div className="mx-auto flex h-16 w-full max-w-[1160px] items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-1.5 rounded-md text-[22px] tracking-[-0.03em]">
          <Mark className="size-6" />
          Easy Read
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <Link href="/#how" className={NAV_LINK}>
            How it works
          </Link>
          <Link href="/#letter" className={NAV_LINK}>
            Samples
          </Link>
        </nav>
        <div className="ml-auto">
          <Link href={home ? "#letter" : "/"} className={buttonVariants({ size: "xs" })}>
            {home ? "Convert a letter" : "New letter"}
          </Link>
        </div>
      </div>
    </header>
  );
}
