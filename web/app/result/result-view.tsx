"use client";

/**
 * Placeholder result view. Task 22 replaces it with the side-by-side screen.
 * It reads the result from `useConversion()`; after a reload there is no
 * result, because nothing is stored (R7.4).
 */
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useConversion } from "@/src/ui/conversion-context";

export function ResultView() {
  const { result } = useConversion();
  const back = (
    <Link href="/" className={buttonVariants({ variant: "outline", size: "lg", className: "h-11 w-fit px-6 text-base" })}>
      Convert another letter
    </Link>
  );

  if (!result) {
    return (
      <div className="flex flex-col gap-4">
        <p>There is no Easy Read version to show. Letters aren&apos;t saved, so convert the letter again.</p>
        {back}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert role="note">
        <AlertDescription className="text-base text-foreground">{result.notice}</AlertDescription>
      </Alert>
      <Badge variant={result.status === "passed" ? "secondary" : "destructive"} className="h-7 px-3 text-sm">
        {result.status}
      </Badge>
      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="original-heading" className="flex flex-col gap-2">
          <h2 id="original-heading" className="text-xl font-semibold">
            Original
          </h2>
          <p className="whitespace-pre-wrap">{result.original.text}</p>
        </section>
        <section aria-labelledby="easy-read-heading" className="flex flex-col gap-2">
          <h2 id="easy-read-heading" className="text-xl font-semibold">
            Easy Read
          </h2>
          {result.status === "blocked" ? (
            <p>The Easy Read version was withheld because a key fact did not match the letter.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {result.lines.map((line) => (
                <li key={line.id}>{line.text}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {back}
    </div>
  );
}
