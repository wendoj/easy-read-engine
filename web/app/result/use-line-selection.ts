import { useCallback, useRef, useState } from "react";
import { prefersReducedMotion } from "@/src/ui/motion";
import { type LineRow, type ResultLayout, scrollTopToReveal } from "@/src/ui/result-layout";
import { lineElementId } from "./line-row";

/** The selected line, and the Original sentence it came from scrolled into view. */
export function useLineSelection(layout: ResultLayout | null) {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const originalRef = useRef<HTMLDivElement | null>(null);
  const sentenceEls = useRef(new Map<string, HTMLElement>());

  const register = useCallback((sentenceId: string, el: HTMLElement | null) => {
    if (el) sentenceEls.current.set(sentenceId, el);
    else sentenceEls.current.delete(sentenceId);
  }, []);

  /** Scrolls only the Original box, so the page and the selected line stay still. */
  const revealSentence = useCallback((sentenceId: string) => {
    const container = originalRef.current;
    const el = sentenceEls.current.get(sentenceId);
    if (!container || !el) return;
    const c = container.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const top = scrollTopToReveal({ top: c.top, height: c.height, scrollTop: container.scrollTop }, e);
    container.scrollTo({
      top,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  /** Called after the Check report has closed, so focus isn't sent back to the report button. */
  const onGoToLine = (lineId: string) => {
    const row = layout?.rows.find((r) => r.id === lineId);
    if (!row) return;
    setSelectedLineId(row.id);
    if (row.sourceSentenceId !== null) revealSentence(row.sourceSentenceId);
    const el = document.getElementById(lineElementId(row.id));
    if (el === null) return;
    el.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    el.focus({ preventScroll: true });
  };

  /** Selecting the selected line again clears the selection. */
  const onSelect = (row: LineRow) => {
    const next = selectedLineId === row.id ? null : row.id;
    setSelectedLineId(next);
    if (next !== null && row.sourceSentenceId !== null) revealSentence(row.sourceSentenceId);
  };

  const selectedRow = layout?.rows.find((r) => r.id === selectedLineId) ?? null;

  return {
    selectedLineId,
    selectedSentenceId: selectedRow?.sourceSentenceId ?? null,
    originalRef,
    register,
    onGoToLine,
    onSelect,
  };
}
