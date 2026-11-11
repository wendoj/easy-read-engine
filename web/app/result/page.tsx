import { ResultView } from "./result-view";

/** Placeholder until task 22 builds the side-by-side result screen. */
export default function ResultPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 text-lg sm:px-6">
      <h1 className="text-3xl font-semibold">Easy Read version</h1>
      <ResultView />
    </main>
  );
}
