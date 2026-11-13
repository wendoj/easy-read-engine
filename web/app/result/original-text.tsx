import type { FactStyle, HighlightedSegment } from "@/src/ui/key-fact-highlight";
import { FactText } from "./fact-text";

function OriginalSentence({
  segment,
  selected,
  styles,
}: {
  segment: HighlightedSegment & { kind: "sentence" };
  selected: boolean;
  styles: ReadonlyMap<string, FactStyle>;
}) {
  const content = <FactText pieces={segment.pieces} styles={styles} />;
  if (!selected) return <span>{content}</span>;
  return <mark className="rounded-sm bg-accent-tint text-foreground ring-2 ring-primary">{content}</mark>;
}

export function OriginalText({
  segments,
  styles,
  selectedSentenceId,
  register,
  containerRef,
}: {
  segments: HighlightedSegment[];
  styles: ReadonlyMap<string, FactStyle>;
  selectedSentenceId: string | null;
  register: (sentenceId: string, el: HTMLElement | null) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={containerRef}
      role="region"
      aria-labelledby="original-heading"
      tabIndex={0}
      className="max-h-[50vh] overflow-y-auto overscroll-contain p-5 text-lg leading-normal whitespace-pre-wrap focus-visible:outline-offset-[-3px] lg:max-h-[calc(100vh-8rem)]"
    >
      {segments.map((segment) =>
        segment.kind === "text" ? (
          <span key={`t${segment.start}`}>
            <FactText pieces={segment.pieces} styles={styles} />
          </span>
        ) : (
          <span key={`s${segment.start}`} ref={(el) => register(segment.sentenceId, el)}>
            <OriginalSentence segment={segment} selected={segment.sentenceId === selectedSentenceId} styles={styles} />
          </span>
        ),
      )}
    </div>
  );
}
