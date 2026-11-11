import { sampleCatalog } from "@/src/samples/catalog";
import { InputScreen } from "./input-screen";

export default function Home() {
  // IDs and labels only. A sample's text and lines are sent when it is loaded (/api/sample).
  const samples = sampleCatalog().list();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 text-lg sm:px-6">
      <h1 className="text-3xl font-semibold">Make a letter Easy Read</h1>
      <InputScreen samples={samples} />
    </main>
  );
}
