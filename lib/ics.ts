import { addDays } from "./dates";
import type { EventRow } from "./types";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const d = (date: string) => date.replace(/-/g, "");
const dt = (date: string, time: string) => `${d(date)}T${time.replace(":", "")}00`;

function addHours(time: string, hours: number): { time: string; nextDay: boolean } {
  const [hh, mm] = time.split(":").map(Number);
  const total = hh + hours;
  return { time: `${String(total % 24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, nextDay: total >= 24 };
}

/** A single-event .ics file. Times are in UK local time. */
export function toIcs(e: EventRow, host: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//popup-posters//EN", "BEGIN:VEVENT", `UID:event-${e.id}@${host}`];
  lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`);
  const start = e.start_date!;
  if (e.start_time) {
    lines.push(`DTSTART;TZID=Europe/London:${dt(start, e.start_time)}`);
    const endDate = e.end_date ?? start;
    if (e.end_time) {
      lines.push(`DTEND;TZID=Europe/London:${dt(endDate, e.end_time)}`);
    } else {
      const end = addHours(e.start_time, 2);
      lines.push(`DTEND;TZID=Europe/London:${dt(end.nextDay ? addDays(start, 1) : start, end.time)}`);
    }
  } else {
    lines.push(`DTSTART;VALUE=DATE:${d(start)}`, `DTEND;VALUE=DATE:${d(addDays(e.end_date ?? start, 1))}`);
  }
  lines.push(`SUMMARY:${esc(e.title)}`);
  const where = [e.venue, e.area].filter(Boolean).join(", ");
  if (where) lines.push(`LOCATION:${esc(where)}`);
  const desc = [e.description, e.price].filter(Boolean).join("\n");
  if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
