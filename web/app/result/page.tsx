import { ResultView } from "./result-view";

/** Side-by-side result screen (task 22). The result lives in client state only, so `ResultView` does the work. */
export default function ResultPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 text-lg sm:px-6">
      <h1 className="text-3xl font-semibold">Easy Read version</h1>
      <ResultView />
    </main>
  );
}
