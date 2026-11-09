import { hasApiKey } from "@/lib/auth";
import { filterOptions, json, toApiEvent } from "@/lib/api";
import { todayLondon } from "@/lib/dates";
import { homePoint } from "@/lib/geo";
import { listEvents } from "@/lib/listing";

/** Event list for the Android app. Same filters as the website, plus `q` for text search. */
export async function GET(req: Request) {
  if (!hasApiKey(req)) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const p = Object.fromEntries(url.searchParams) as Record<string, string>;
  const today = todayLondon();
  const listing = await listEvents(p, today, await homePoint());
  return json({
    today,
    events: listing.items.map((i) => toApiEvent(i, url.origin)),
    pending: listing.pending.map((i) => toApiEvent(i, url.origin)),
    areas: listing.areas.map(([, label]) => label),
    unlocated: listing.unlocated,
    hasDistances: listing.hasDistances,
    options: filterOptions(today),
  });
}
