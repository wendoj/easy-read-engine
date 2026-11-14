"use client";
/**
 * Starts closed, showing only its heading and count, so the Easy Read lines
 * stay close. Ticks live in this component, survive closing, and are never
 * saved. Nothing animates.
 */
import { CalendarPlus, ScanSearch } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CALENDAR_FILENAME, buildIcs } from "@/src/ui/calendar";
import type { FactStyle } from "@/src/ui/key-fact-highlight";
import type { ReadAloud } from "@/src/ui/read-aloud";
import { saveBlob } from "@/src/ui/save-blob";
import { type ToDoItem, toDoCountLabel } from "@/src/ui/to-do-list";
import { FactText, ListenButton } from "./fact-text";
import { SummaryPanel } from "./summary-panel";

export const TO_DO_HEADING = "What you need to do";

const MAIN_TASK = /\b(pay|must|need to|have to)\b/iu;

export function ToDoBox({
  items,
  styles,
  notice,
  readAloud,
  lineNumbers,
  onGoToLine,
}: {
  items: ToDoItem[];
  styles: ReadonlyMap<string, FactStyle>;
  /** The simplified-version notice, put in the calendar file. */
  notice: string;
  readAloud: ReadAloud;
  /** Line ID to its number on screen, from 1. */
  lineNumbers: ReadonlyMap<string, number>;
  onGoToLine: (lineId: string) => void;
}) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  const toggle = (id: string, checked: boolean) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const addToCalendar = (item: ToDoItem) => {
    if (item.deadline === null) return;
    const ics = buildIcs({
      title: item.row.text,
      date: item.deadline,
      notice,
      uid: `${crypto.randomUUID()}@easy-read`,
      now: new Date(),
    });
    saveBlob(new Blob([ics], { type: "text/calendar;charset=utf-8" }), CALENDAR_FILENAME);
  };

  // A payment or a "must" is what the reader most needs to see; otherwise the first item.
  const lead = items.find((i) => MAIN_TASK.test(i.row.text)) ?? items[0];
  return (
    <SummaryPanel
      heading={TO_DO_HEADING}
      count={toDoCountLabel(items.length)}
      preview={`For example: ${lead.row.text}`}
      open={open}
      onOpenChange={setOpen}
      emphasis
    >
      <ul className="flex flex-col divide-y divide-border">
        {items.map((item, index) => {
          const textId = `to-do-text-${item.row.id}`;
          const label = `item ${index + 1}`;
          const number = lineNumbers.get(item.row.id);
          return (
            <li key={item.row.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <Checkbox
                aria-labelledby={textId}
                checked={done.has(item.row.id)}
                onCheckedChange={(checked) => toggle(item.row.id, checked === true)}
                className="mt-0.5 size-7 border-2 border-foreground"
              />
              <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
                <p
                  id={textId}
                  className={`text-xl leading-normal [overflow-wrap:anywhere] ${done.has(item.row.id) ? "text-muted-foreground" : ""}`}
                >
                  <FactText pieces={item.row.pieces} styles={styles} explain />
                </p>
                <div className="flex flex-wrap gap-2">
                  <ListenButton id={`todo-${item.row.id}`} text={item.row.text} label={label} readAloud={readAloud} />
                  {item.deadline !== null && (
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`Add to calendar, ${label}`}
                      onClick={() => addToCalendar(item)}
                    >
                      <CalendarPlus aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
                      Add to calendar
                    </Button>
                  )}
                  {number !== undefined && (
                    <Button type="button" variant="outline" onClick={() => onGoToLine(item.row.id)}>
                      <ScanSearch aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
                      Go to line {number}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </SummaryPanel>
  );
}
