"use client";
/**
 * Text with key-fact highlights (R5.3), and the small controls that sit on a
 * line of Easy Read text: tap-a-word, Listen.
 */
import { Square, Volume2 } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type GlossaryEntry, findGlossaryMatches, splitAtGlossary } from "@/src/ui/glossary";
import {
  type FactStyle,
  type HighlightPiece,
  pieceClassName,
  pieceTitle,
} from "@/src/ui/key-fact-highlight";
import type { ReadAloud } from "@/src/ui/read-aloud";
import { symbolSrc } from "@/src/ui/result-layout";

const WORD_PICTURE_SIZE = 64;

/**
 * A hard word. Tapping it opens its meaning and a picture. A dotted underline
 * in the accent colour marks it; fact highlights use other underline styles
 * and a background, so the two stay apart.
 */
function ExplainedWord({ entry, text }: { entry: GlossaryEntry; text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer rounded-sm border-b-4 border-dotted border-primary [-webkit-tap-highlight-color:transparent] hover:bg-accent-tint"
        >
          {text}
          <span className="sr-only"> (open the meaning)</span>
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={`What "${entry.term}" means`} className="flex-row items-start gap-4">
        {entry.symbolId !== null && (
          <Image
            src={symbolSrc(entry.symbolId)}
            alt=""
            width={WORD_PICTURE_SIZE}
            height={WORD_PICTURE_SIZE}
            unoptimized
            className="size-16 shrink-0 rounded-lg border border-border bg-white object-contain"
          />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold">{entry.term}</p>
          <p className="leading-normal">{entry.meaning}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PieceText({ text, explain }: { text: string; explain: boolean }) {
  if (!explain) return <>{text}</>;
  const parts = splitAtGlossary(text, findGlossaryMatches(text));
  return (
    <>
      {parts.map((part, i) =>
        part.entry === null ? (
          <span key={i}>{part.text}</span>
        ) : (
          <ExplainedWord key={i} entry={part.entry} text={part.text} />
        ),
      )}
    </>
  );
}

/**
 * Text with key-fact highlights (R5.3). Each fact keeps its colour in both
 * columns; the underline style and a type label mean colour is never the only
 * signal. The label is screen-reader text after the fact and a tooltip.
 *
 * With `explain`, hard words from the glossary can be tapped for their meaning.
 * Use it for Easy Read lines only. The Original is shown as it is.
 */
export function FactText({
  pieces,
  styles,
  explain = false,
}: {
  pieces: HighlightPiece[];
  styles: ReadonlyMap<string, FactStyle>;
  explain?: boolean;
}) {
  return (
    <>
      {pieces.map((piece) => {
        const className = pieceClassName(piece, styles);
        if (className === null) {
          return (
            <span key={piece.start}>
              <PieceText text={piece.text} explain={explain} />
            </span>
          );
        }
        const labels = piece.endingFactIds.flatMap((id) => styles.get(id)?.label ?? []);
        return (
          <span key={piece.start}>
            <span className={className} title={pieceTitle(piece, styles)}>
              <PieceText text={piece.text} explain={explain} />
            </span>
            {labels.length > 0 && <span className="sr-only"> ({labels.join("; ")})</span>}
          </span>
        );
      })}
    </>
  );
}

/**
 * Reads one line aloud with the browser's speech. Shows nothing where the
 * browser has none. Only 1 thing is read at a time; pressing it again stops it.
 */
export function ListenButton({
  id,
  text,
  label,
  readAloud,
  disabled = false,
}: {
  id: string;
  text: string;
  /** Names the line for a screen reader, e.g. "line 3". */
  label: string;
  readAloud: ReadAloud;
  disabled?: boolean;
}) {
  if (!readAloud.supported) return null;
  const speaking = readAloud.speakingId === id;
  const Icon = speaking ? Square : Volume2;
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      aria-label={speaking ? "Stop listening" : `Listen to ${label}`}
      onClick={() => readAloud.toggle(id, text)}
    >
      <Icon aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
      {speaking ? "Stop" : "Listen"}
    </Button>
  );
}
