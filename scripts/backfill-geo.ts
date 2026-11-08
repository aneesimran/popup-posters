// Fills in locations for events saved before distance support (or whose lookup failed).
// Usage: npm run geo:backfill
import { eventsMissingLocation, setLocation } from "../lib/db";
import { distanceFromHome, formatMiles, homePoint, locateEvent } from "../lib/geo";

const home = await homePoint();
if (!home) console.warn("HOME_POSTCODE is not set or not found; distances won't be shown.");
const events = await eventsMissingLocation();
for (const e of events) {
  const geo = await locateEvent(e, home);
  await setLocation(e.id, geo);
  const miles = geo ? distanceFromHome(geo, home) : null;
  console.log(`#${e.id} ${e.title}: ${geo ? `${geo.source}${miles != null ? `, ${formatMiles(miles)}` : ""}` : "not found"}`);
  await new Promise((r) => setTimeout(r, 1100)); // OpenStreetMap allows ~1 request/second
}
console.log(`Done (${events.length} event${events.length === 1 ? "" : "s"}).`);
