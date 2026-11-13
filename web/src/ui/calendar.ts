/**
 * An all-day iCalendar event (RFC 5545) for one deadline, made in the browser.
 * The description is the simplified-version notice, so the file also says the
 * original letter is the official one.
 */

export const CALENDAR_FILENAME = "deadline.ics";

export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds at 75 UTF-8 bytes, never inside a character. */
export function foldIcsLine(line: string): string[] {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  // The first line may hold 75 bytes. Later ones have a leading space, so 74.
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out.push(out.length === 0 ? current : ` ${current}`);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += char;
    bytes += size;
  }
  out.push(out.length === 0 ? current : ` ${current}`);
  return out;
}

function compact(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/** `YYYYMMDD` of the next day: an all-day event ends the day after. */
export function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return [
    String(next.getUTCFullYear()).padStart(4, "0"),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface CalendarEvent {
  title: string;
  /** `YYYY-MM-DD`. */
  date: string;
  notice: string;
  uid: string;
  now: Date;
}

export function buildIcs(event: CalendarEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Easy Read//Deadline//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(event.now)}`,
    `DTSTART;VALUE=DATE:${compact(event.date)}`,
    `DTEND;VALUE=DATE:${nextDay(event.date)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.notice)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}
