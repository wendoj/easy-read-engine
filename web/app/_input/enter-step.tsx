"use client";
import { ArrowRight, ClipboardPaste, FileUp, LoaderCircle } from "lucide-react";
import { Panel, PanelBar } from "@/components/composer";
import { Steps } from "@/components/steps";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { SampleInfo } from "@/src/samples/sample";
import { FileDrop } from "./file-drop";
import { ErrorAlert, PANEL_FIELD, SendBar, WordCount } from "./panel-parts";
import { SampleChips } from "./sample-chips";
import type { InputFlow } from "./use-input-flow";

export function EnterStep({
  flow,
  ids,
  samples,
  accessNotice,
}: {
  flow: InputFlow;
  ids: { paste: string; pasteCount: string; file: string };
  samples: readonly SampleInfo[];
  accessNotice: React.ReactNode;
}) {
  const { tab, pasted, file, locked } = flow;
  const reading = flow.busy === "reading";
  // Visitors without access see the samples first, as they are what they can use.
  const sampleChips = (
    <SampleChips
      samples={samples}
      loadingId={flow.sampleId}
      disabled={flow.busy !== null}
      onShow={(id) => void flow.showSample(id)}
    />
  );
  return (
    <section className="flex flex-col gap-6" aria-label="Your letter">
      <Steps current={1} />
      {accessNotice}
      {locked && sampleChips}
      <Panel>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            flow.setTab(value);
            flow.setError(null);
          }}
          className="gap-0"
        >
          <PanelBar>
            <TabsList className="h-14! w-full sm:w-fit" aria-label="How to add your letter">
              <TabsTrigger value="paste" disabled={reading} className="px-5">
                <ClipboardPaste aria-hidden strokeWidth={2} absoluteStrokeWidth />
                Paste text
              </TabsTrigger>
              <TabsTrigger value="upload" disabled={reading} className="px-5">
                <FileUp aria-hidden strokeWidth={2} absoluteStrokeWidth />
                Photo or PDF
              </TabsTrigger>
            </TabsList>
            {tab === "paste" && <WordCount text={pasted} id={ids.pasteCount} />}
          </PanelBar>

          <TabsContent value="paste" className="text-lg">
            <label htmlFor={ids.paste} className="block px-4 pt-4 text-lg font-semibold sm:px-6">
              Letter text
            </label>
            <Textarea
              id={ids.paste}
              value={pasted}
              onChange={(event) => flow.setPasted(event.target.value)}
              aria-describedby={ids.pasteCount}
              placeholder="Paste your letter here"
              disabled={locked}
              className={PANEL_FIELD}
            />
            <SendBar>
              <Button type="button" onClick={() => flow.goToConfirm(pasted)} disabled={pasted.trim() === "" || locked}>
                Next
                <ArrowRight aria-hidden data-icon="inline-end" />
              </Button>
            </SendBar>
          </TabsContent>

          <TabsContent value="upload" className="text-lg">
            <FileDrop
              id={ids.file}
              file={file}
              disabled={reading || locked}
              onFile={(next) => {
                flow.setFile(next);
                flow.setError(null);
              }}
            />
            <p aria-live="polite" role="status" className="px-6 pb-3 text-lg font-semibold empty:hidden">
              {reading ? "Reading the file" : ""}
            </p>
            <SendBar>
              <Button type="button" onClick={flow.readFile} disabled={!file || reading || locked} aria-busy={reading || undefined}>
                {reading && <LoaderCircle aria-hidden data-icon="inline-start" className="motion-safe:animate-spin" />}
                {reading ? "Reading the letter" : "Read the letter"}
              </Button>
            </SendBar>
          </TabsContent>
        </Tabs>
      </Panel>

      <ErrorAlert message={flow.error} />

      {!locked && sampleChips}
    </section>
  );
}
