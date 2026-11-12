"use client";
/**
 * "What you need to do": the lines that hold a required action, as a
 * checklist at the top of the Easy Read side. See `src/ui/to-do-list.ts`.
 *
 * It starts closed, showing only the heading and "N things to do", so the
 * Easy Read lines are reachable without scrolling. The open or closed state
 * is not saved. Ticks live in this component, so they survive closing.
 * Opening animates height and opacity (200ms, strong ease-out); under
 * reduced motion it only fades. Items carry no failed-rule badge: failures
 * are in the Check report (R3.4).
 *
 * The ticks are only on this screen. They are not saved anywhere (R7.4).
 * "Add to calendar" downloads an .ics file for the line's deadline, made in
 * the browser.
 */
import { CalendarPlus, ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CALENDAR_FILENAME, buildIcs } from "@/src/ui/calendar";
import type { FactStyle } from "@/src/ui/key-fact-highlight";
import type { ReadAloud } from "@/src/ui/read-aloud";
import { saveBlob } from "@/src/ui/save-blob";
import { EASE_OUT } from "@/src/ui/motion";
import { type ToDoItem, toDoCountLabel } from "@/src/ui/to-do-list";
import { FactText, ListenButton } from "./fact-text";

export const TO_DO_HEADING = "What you need to do";

export function ToDoBox({
  items,
  styles,
  notice,
  readAloud,
}: {
  items: ToDoItem[];
  styles: ReadonlyMap<string, FactStyle>;
  /** The R7.1 notice, put in the calendar file. */
  notice: string;
  readAloud: ReadAloud;
}) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion() ?? false;
  const panelId = useId();
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

  return (
    <section aria-labelledby="to-do-heading" className="rounded-2xl border-2 border-primary bg-card">
      <h2 id="to-do-heading" className="text-[28px] leading-tight font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-12 w-full items-center gap-4 rounded-[14px] p-5 text-left sm:p-6"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span>{TO_DO_HEADING}</span>
            <span className="text-xl font-normal text-muted-foreground">{toDoCountLabel(items.length)}</span>
          </span>
          <ChevronDown
            aria-hidden
            strokeWidth={2}
            absoluteStrokeWidth
            className={`size-7 shrink-0 ${open ? "rotate-180" : ""} motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)]`}
          />
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            key="to-do-panel"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0.15 : 0.2, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <ul className="flex flex-col divide-y divide-border px-5 pb-5 sm:px-6 sm:pb-6">
              {items.map((item, index) => {
                const textId = `to-do-text-${item.row.id}`;
                const label = `item ${index + 1}`;
                return (
                  <li key={item.row.id} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                    <Checkbox
                      aria-labelledby={textId}
                      checked={done.has(item.row.id)}
                      onCheckedChange={(checked) => toggle(item.row.id, checked === true)}
                      className="mt-1.5 size-7 border-2 border-foreground"
                    />
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
                      <p
                        id={textId}
                        className={`text-2xl leading-normal ${done.has(item.row.id) ? "text-muted-foreground" : ""}`}
                      >
                        <FactText pieces={item.row.pieces} styles={styles} explain />
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <ListenButton
                          id={`todo-${item.row.id}`}
                          text={item.row.text}
                          label={label}
                          readAloud={readAloud}
                        />
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
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
