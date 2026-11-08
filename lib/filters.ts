import { addDays } from "./dates";

export const WHEN_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "Next 7 days" },
  { value: "month", label: "This month" },
  { value: "m1", label: "Next month" },
  { value: "m2", label: "In 2 months" },
  { value: "m3", label: "In 3 months" },
] as const;
export type When = (typeof WHEN_OPTIONS)[number]["value"];

export const WITHIN_OPTIONS = [1, 3, 5, 10] as const;

export function parseWhen(v: string | undefined): When | null {
  return WHEN_OPTIONS.some((o) => o.value === v) ? (v as When) : null;
}

export function parseWithin(v: string | undefined): number | null {
  const n = Number(v);
  return (WITHIN_OPTIONS as readonly number[]).includes(n) ? n : null;
}

/** First and last day of the calendar month `offset` months after today's. */
function monthRange(today: string, offset: number): [string, string] {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m + offset, 0)).toISOString().slice(0, 10);
  return [first, last];
}

/** Chip label: the month's name for the m1–m3 filters ("December"), else the fixed label. */
export function whenLabel(value: When, today: string): string {
  const offset = { m1: 1, m2: 2, m3: 3 }[value as "m1" | "m2" | "m3"];
  if (!offset) return WHEN_OPTIONS.find((o) => o.value === value)!.label;
  const [first] = monthRange(today, offset);
  return new Date(`${first}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sun, 6 = Sat

/** Inclusive [from, to] date range for a "when" filter. */
export function whenRange(when: When, today: string): [string, string] {
  switch (when) {
    case "today":
      return [today, today];
    case "week":
      return [today, addDays(today, 6)];
    case "month":
      return [today, monthRange(today, 0)[1]];
    case "m1":
      return monthRange(today, 1);
    case "m2":
      return monthRange(today, 2);
    case "m3":
      return monthRange(today, 3);
    case "weekend": {
      const d = weekday(today);
      if (d === 6) return [today, addDays(today, 1)];
      if (d === 0) return [today, today];
      return [addDays(today, 6 - d), addDays(today, 7 - d)];
    }
  }
}

/** Does an event (possibly multi-day) fall on any day in the range? */
export function overlaps(e: { start_date: string | null; end_date: string | null }, [from, to]: [string, string]): boolean {
  if (!e.start_date) return false;
  return e.start_date <= to && (e.end_date ?? e.start_date) >= from;
}
