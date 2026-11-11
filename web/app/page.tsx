import Link from "next/link";
import { Backdrop } from "@/components/composer";
import { buttonVariants } from "@/components/ui/button";
import { sampleCatalog } from "@/src/samples/catalog";
import { InputScreen } from "./input-screen";

const STEPS = [
  {
    title: "Paste or upload",
    text: "Paste the letter text, or upload a PDF or a photo of it.",
    backdrop: "er-backdrop-cool",
    mock: "letter",
  },
  {
    title: "Check the text",
    text: "Fix any words the scan got wrong before you convert.",
    backdrop: "er-backdrop-warm",
    mock: "check",
  },
  {
    title: "Get Easy Read",
    text: "Short lines, one idea each, with a picture. Dates, money and phone numbers are checked against the letter.",
    backdrop: "er-backdrop",
    mock: "lines",
  },
] as const;

/** Small decorative window for each step card, like the product shots on devin.ai. */
function StepMock({ kind }: { kind: (typeof STEPS)[number]["mock"] }) {
  const bar = "h-2.5 rounded-full bg-black/10";
  return (
    <div aria-hidden className="w-full max-w-64 rounded-xl bg-card p-4 shadow-window">
      {kind === "letter" && (
        <div className="flex flex-col gap-2.5">
          <div className={`${bar} w-1/3`} />
          <div className={`${bar} w-full`} />
          <div className={`${bar} w-11/12`} />
          <div className={`${bar} w-4/5`} />
          <div className={`${bar} w-full`} />
          <div className={`${bar} w-2/3`} />
        </div>
      )}
      {kind === "check" && (
        <div className="flex flex-col gap-2.5">
          <div className={`${bar} w-full`} />
          <div className="flex gap-1.5">
            <div className={`${bar} w-1/3`} />
            <div className="h-2.5 w-1/4 rounded-full bg-accent-blue/50" />
            <div className={`${bar} w-1/4`} />
          </div>
          <div className={`${bar} w-5/6`} />
          <div className="mt-2 ml-auto h-6 w-16 rounded-full bg-black" />
        </div>
      )}
      {kind === "lines" && (
        <div className="flex flex-col gap-3">
          {["w-3/4", "w-1/2", "w-2/3"].map((w) => (
            <div key={w} className="flex items-center gap-3">
              <div className="size-7 shrink-0 rounded-md bg-wash outline outline-1 -outline-offset-1 outline-black/10" />
              <div className={`${bar} ${w}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  // IDs and labels only. A sample's text and lines are sent when it is loaded (/api/sample).
  const samples = sampleCatalog().list();
  // First-load entrance in CSS (`.er-enter`), 100ms apart: heading, subtitle, input.
  return (
    <main className="flex flex-1 flex-col text-lg">
      <section className="flex flex-col px-4 pt-16 pb-14 sm:pt-[104px] sm:pb-[72px]">
        <h1 className="er-enter max-w-[560px] text-[40px] leading-[1.04] font-normal tracking-[-1.2px]">
          Make any letter easy to read and understand
        </h1>
        <p className="er-enter mt-6 max-w-[440px] text-lg leading-[1.4] text-muted-foreground [--i:1]">
          Paste or upload a letter. You get short, clear lines with a picture for each one, checked against the
          original.
        </p>
        <div className="er-enter mt-8 flex flex-wrap gap-2.5 [--i:2]">
          <Link href="#letter" className={buttonVariants()}>
            Convert a letter
          </Link>
          <Link href="#how" className={buttonVariants({ variant: "outline" })}>
            See how it works
          </Link>
        </div>
      </section>

      <section id="letter" aria-label="Your letter" className="er-enter scroll-mt-6 px-4 pb-20 [--i:3]">
        <Backdrop>
          <div className="mx-auto max-w-[880px]">
            <InputScreen samples={samples} />
          </div>
        </Backdrop>
      </section>

      <section
        id="how"
        aria-labelledby="how-heading"
        className="flex scroll-mt-6 flex-col gap-10 border-t border-border px-4 pt-20 pb-24"
      >
        <h2 id="how-heading" className="text-[40px] leading-[1.04] font-normal tracking-[-1.2px]">
          From a confusing letter to clear lines
        </h2>
        <ol className="grid gap-6 md:grid-cols-3 md:gap-2">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-4">
              <div className={`${step.backdrop} flex aspect-[4/3] items-center justify-center p-8`}>
                <StepMock kind={step.mock} />
              </div>
              <div className="flex flex-col gap-1 pr-4">
                <p className="label-mono text-muted-foreground">Step {i + 1}</p>
                <h3 className="text-[22px] leading-[1.25] font-normal tracking-[-0.01em]">{step.title}</h3>
                <p className="text-base leading-[1.4] text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
