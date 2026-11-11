import { ResultView } from "./result-view";

/** Side-by-side result screen (task 22). The result lives in client state only, so `ResultView` does the work. */
export default function ResultPage() {
  return (
    <main className="flex w-full flex-1 flex-col gap-8 px-4 pt-14 pb-24 text-lg sm:pt-20">
      <h1 className="er-enter text-[40px] leading-[1.04] font-normal tracking-[-1.2px]">Your Easy Read letter</h1>
      <ResultView />
    </main>
  );
}
