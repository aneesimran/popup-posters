// Fills in locations for events saved before distance support (or whose lookup failed).
// Usage: npm run geo:backfill            (only events without a location)
//        npm run geo:backfill -- --all   (look every event up again, e.g. after improving the lookup)
import { allEvents, eventsMissingLocation, setLocation, setRegion } from "../lib/db";
import { guessRegions } from "../lib/gemini";
import { distanceFromHome, formatMiles, homePoint, locateEvent } from "../lib/geo";

const home = await homePoint();
if (!home) console.warn("HOME_POSTCODE is not set or not found; distances won't be shown.");
const all = process.argv.includes("--all");
const events = all ? await allEvents() : await eventsMissingLocation();
// Events saved before `region` existed: ask Gemini for all their cities/counties in one go.
const noRegion = events.filter((e) => !e.region && (e.area || e.venue));
if (noRegion.length) {
  const items = noRegion.map(({ id, title, venue, area, postcode }) => ({ id, title, venue, area, postcode }));
  let regions = new Map<number, string>();
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      regions = await guessRegions(items);
      break;
    } catch (err) {
      console.warn(`Gemini busy (attempt ${attempt}), retrying in 30s…`);
      if (attempt === 6) console.warn("Giving up on city/county; locations will use the area alone.");
      else await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  for (const e of noRegion) {
    const r = regions.get(e.id);
    if (r) { e.region = r; await setRegion(e.id, r); }
  }
  console.log(`Filled in city/county for ${regions.size} of ${noRegion.length} events.`);
}
let changed = 0;
for (const e of events) {
  const geo = await locateEvent(e, home);
  const before = distanceFromHome(e, home);
  const after = geo ? distanceFromHome(geo, home) : null;
  const moved = before == null || after == null || Math.abs(before - after) > 0.3;
  if (!geo && e.lat != null) {
    console.log(`#${e.id} ${e.title}: not found now, keeping ${formatMiles(before!)}`);
    continue;
  }
  await setLocation(e.id, geo);
  if (moved) changed++;
  if (moved || !all) {
    const fmt = (m: number | null) => (m == null ? "none" : formatMiles(m));
    console.log(`#${e.id} ${e.title} [${[e.area ?? e.venue, e.region].filter(Boolean).join(", ")}]: ${fmt(before)} -> ${fmt(after)} (${geo?.source ?? "not found"})`);
  }
}
console.log(`Done: ${events.length} checked, ${changed} changed.`);
