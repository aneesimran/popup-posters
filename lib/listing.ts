import * as db from "./db";
import { overlaps, parseWhen, parseWithin, whenRange, type When } from "./filters";
import { distanceFromHome, type Point } from "./geo";
import type { EventRow } from "./types";

export type ListParams = { q?: string; area?: string; past?: string; when?: string; within?: string; sort?: string };
export type ListItem = { e: EventRow; miles: number | null };

export const areaKey = (a: string | null) => a?.trim().toLowerCase() ?? "";

/** "winter market ilford" matches when every word appears in the title, venue, area, region or description. */
export function matchesSearch(e: EventRow, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [e.title, e.venue, e.area, e.region, e.description, e.postcode].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export type Listing = {
  items: ListItem[];
  pending: ListItem[];
  /** Areas present in the unfiltered list, as [key, label], sorted by label. */
  areas: [string, string][];
  /** Events hidden by the distance filter because their location is unknown. */
  unlocated: number;
  hasDistances: boolean;
  showPast: boolean;
  when: When | null;
  within: number | null;
  sort: "near" | "new" | null;
  selectedArea: string;
};

/** The filtered, sorted event list shared by the website and the Android app's API. */
export async function listEvents(params: ListParams, today: string, home: Point | null): Promise<Listing> {
  const showPast = params.past === "1";
  const when = showPast ? null : parseWhen(params.when);
  const within = parseWithin(params.within);
  const sort = params.sort === "near" || params.sort === "new" ? params.sort : null;
  const q = params.q?.trim() ?? "";

  const [events, pendingRows] = await Promise.all([
    showPast ? db.pastEvents(today) : db.upcomingEvents(today),
    showPast ? Promise.resolve([]) : db.pendingEvents(),
  ]);
  const withMiles = (e: EventRow): ListItem => ({ e, miles: distanceFromHome(e, home) });
  const all = events.map(withMiles);

  const areaMap = new Map<string, string>();
  for (const { e } of all) if (e.area && !areaMap.has(areaKey(e.area))) areaMap.set(areaKey(e.area), e.area);
  const areas = [...areaMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const selectedArea = params.area ? areaKey(params.area) : "";

  let items = all;
  if (q) items = items.filter(({ e }) => matchesSearch(e, q));
  if (selectedArea) items = items.filter(({ e }) => areaKey(e.area) === selectedArea);
  if (when) {
    const range = whenRange(when, today);
    items = items.filter(({ e }) => overlaps(e, range));
  }
  const unlocated = within ? items.filter((i) => i.miles == null).length : 0;
  if (within) items = items.filter((i) => i.miles != null && i.miles <= within);
  if (sort === "near") items = [...items].sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity));
  if (sort === "new") items = [...items].sort((a, b) => new Date(b.e.created_at).getTime() - new Date(a.e.created_at).getTime());

  const pending = pendingRows.map(withMiles).filter(({ e }) => !q || matchesSearch(e, q));

  return {
    items,
    pending,
    areas,
    unlocated,
    hasDistances: !!home && all.some((i) => i.miles != null),
    showPast,
    when,
    within,
    sort,
    selectedArea,
  };
}
