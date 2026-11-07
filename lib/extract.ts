import { isValidDate, isValidTime } from "./dates";
import type { DateReply, Extraction } from "./types";

function str(v: unknown, max = 300): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  if (!s || /^(null|n\/a|unknown|none)$/i.test(s)) return null;
  return s.slice(0, max);
}

function dates(raw: Record<string, unknown>) {
  const start_date = isValidDate(raw.start_date) ? raw.start_date : null;
  let end_date = isValidDate(raw.end_date) ? raw.end_date : null;
  if (!start_date || (end_date && end_date <= start_date)) end_date = null;
  const start_time = isValidTime(raw.start_time) ? raw.start_time : null;
  const end_time = start_time && isValidTime(raw.end_time) ? raw.end_time : null;
  return { start_date, end_date, start_time, end_time };
}

/** Validate and clean whatever JSON Gemini returned for a poster. */
export function normalizeExtraction(input: unknown): Extraction {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const title = str(raw.title, 120);
  return {
    is_event: raw.is_event === true && !!title,
    title,
    ...dates(raw),
    venue: str(raw.venue, 160),
    area: str(raw.area, 60),
    price: str(raw.price, 60),
    description: str(raw.description, 400),
  };
}

/** Validate Gemini's parse of a free-text date reply ("next sat 2pm"). */
export function normalizeDateReply(input: unknown): DateReply {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return dates(raw);
}
