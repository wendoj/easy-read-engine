/**
 * An iCalendar (.ics) file for one deadline: an all-day event on that date.
 * Follows RFC 5545: CRLF line ends, escaped text, lines folded at 75 bytes.
 *
 * The title is the Easy Read line. The description is the simplified-version
 * notice, so the file also says the original letter is the official one (R7.1).
 * The file is made in the browser and never sent anywhere (R7.4).
 */

export const CALENDAR_FILENAME = "deadline.ics";

/** Escapes TEXT values: backslash, semicolon, comma and line breaks. */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a line at 75 bytes (UTF-8), never inside a character. Continuations start with a space. */
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

/** The day after a `YYYY-MM-DD` date, as `YYYYMMDD`. An all-day event ends the next day. */
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
  /** The line text. */
  title: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** The R7.1 notice. */
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
