import { Suspense } from "react";
import { Steps } from "@/components/steps";
import { ResultView } from "./result-view";

/** `ResultView` reads `?sample=<id>` with `useSearchParams`, so it sits in Suspense and the rest is prerendered. */
export default function ResultPage() {
  return (
    <main className="flex w-full flex-1 flex-col gap-6 px-4 pt-10 pb-24 sm:pt-14">
      <h1 className="text-[36px] leading-[1.2] font-semibold sm:text-[40px]">Your Easy Read letter</h1>
      <Steps current={3} />
      <Suspense fallback={null}>
        <ResultView />
      </Suspense>
    </main>
  );
}
