import { addDays } from "./dates";

export const WHEN_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "Next 7 days" },
  { value: "month", label: "This month" },
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

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sun, 6 = Sat

/** Inclusive [from, to] date range for a "when" filter. */
export function whenRange(when: When, today: string): [string, string] {
  switch (when) {
    case "today":
      return [today, today];
    case "week":
      return [today, addDays(today, 6)];
    case "month": {
      const [y, m] = today.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return [today, last];
    }
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
