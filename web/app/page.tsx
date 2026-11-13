import { sampleCatalog } from "@/src/samples/catalog";
import { InputScreen } from "./input-screen";

export default function Home() {
  // IDs and labels only. A sample's text is sent when it is loaded.
  const samples = sampleCatalog().list();
  return (
    <main className="flex flex-1 flex-col px-4 pt-10 pb-24 sm:pt-14">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h1 className="text-[36px] leading-[1.2] font-semibold sm:text-[40px]">Make a letter easier to read</h1>
          <p className="text-xl leading-normal">
            You get the same letter in short sentences, with a picture next to each one.
          </p>
        </div>
        <InputScreen samples={samples} />
      </div>
    </main>
  );
}
