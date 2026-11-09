// Turn a postcode / venue / area into coordinates using free services:
// postcodes.io (UK postcodes and place names) and OpenStreetMap Nominatim.

export type Point = { lat: number; lng: number };
export type GeoSource = "postcode" | "venue" | "area";
export type GeoResult = Point & { source: GeoSource };

const UA = "popup-posters/1.0 (personal event list)";
const TIMEOUT_MS = 6000;

const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;
const OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/;

/** "sw1a1aa" -> "SW1A 1AA"; outward codes like "se14" -> "SE14"; anything else -> null. */
export function normalizePostcode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.toUpperCase().replace(/\s+/g, "").trim();
  const full = s.match(POSTCODE_RE);
  if (full) return `${full[1]} ${full[2]}`;
  return OUTCODE_RE.test(s) ? s : null;
}

/** Straight-line distance in miles. */
export function milesBetween(a: Point, b: Point): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatMiles(miles: number): string {
  if (miles < 0.1) return "<0.1 mi";
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function lookupPostcode(postcode: string): Promise<Point | null> {
  const pc = normalizePostcode(postcode);
  if (!pc) return null;
  const path = pc.includes(" ") ? `postcodes/${encodeURIComponent(pc)}` : `outcodes/${encodeURIComponent(pc)}`;
  const json = (await getJson(`https://api.postcodes.io/${path}`)) as { result?: { latitude?: number; longitude?: number } } | null;
  const r = json?.result;
  if (r?.latitude == null || r?.longitude == null) {
    // Unknown full postcode (typo on the poster?): fall back to its outward code.
    if (pc.includes(" ")) return lookupPostcode(pc.split(" ")[0]);
    return null;
  }
  return { lat: r.latitude, lng: r.longitude };
}

const nearest = <T extends Point>(points: T[], to: Point | null): T | null =>
  points.length === 0 ? null : to ? points.reduce((a, b) => (milesBetween(a, to) <= milesBetween(b, to) ? a : b)) : points[0];

/**
 * A town, neighbourhood or borough. Names repeat across the UK ("Tower Hamlets" is also a part
 * of Dover), so gather candidates from postcodes.io place names and OpenStreetMap (which also
 * knows boroughs) and take the one nearest home.
 */
export async function lookupArea(area: string, region: string | null, home: Point | null): Promise<Point | null> {
  // With a city/county to go on, search for exactly that ("Tower Hamlets, London").
  if (region && !area.toLowerCase().includes(region.toLowerCase())) {
    const inRegion = await searchOsm(`${area}, ${region}`);
    if (inRegion.length) return nearest(inRegion, home);
  }
  const json = (await getJson(`https://api.postcodes.io/places?q=${encodeURIComponent(area)}&limit=20`)) as {
    result?: { name_1?: string; latitude: number; longitude: number }[] | null;
  } | null;
  const wanted = area.trim().toLowerCase();
  const places = (json?.result ?? [])
    .filter((p) => p.name_1?.toLowerCase() === wanted)
    .map((p) => ({ lat: p.latitude, lng: p.longitude }));
  const osm = await searchOsm(area);
  return nearest([...places, ...osm], home);
}

// OpenStreetMap's free service allows about one request a second.
let lastOsmCall = 0;
async function osmTurn() {
  const wait = lastOsmCall + 1100 - Date.now();
  lastOsmCall = Math.max(Date.now(), lastOsmCall + 1100);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function searchOsm(query: string): Promise<Point[]> {
  await osmTurn();
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=gb&format=jsonv2&limit=5`;
  const json = (await getJson(url)) as { lat: string; lon: string }[] | null;
  return (json ?? []).map((r) => ({ lat: Number(r.lat), lng: Number(r.lon) })).filter((p) => Number.isFinite(p.lat));
}

/** Venue matches further than this from the named area are probably a different place. */
const MAX_VENUE_FROM_AREA_MILES = 4;

/**
 * Best guess at where an event is: exact postcode, then the venue (checked against the area),
 * then the centre of the area.
 */
export async function locateEvent(
  e: { postcode: string | null; venue: string | null; area: string | null; region?: string | null },
  home: Point | null,
): Promise<GeoResult | null> {
  if (e.postcode) {
    const p = await lookupPostcode(e.postcode);
    if (p) return { ...p, source: "postcode" };
  }
  const region = e.region ?? null;
  const areaPoint = e.area ? await lookupArea(e.area, region, home) : region ? await lookupArea(region, null, home) : null;
  if (e.venue) {
    // "The Town Hall, Tower Hamlets, London": add the area and region unless the venue already names them.
    const parts = [e.venue];
    for (const extra of [e.area, region]) {
      if (extra && !parts.join(" ").toLowerCase().includes(extra.toLowerCase())) parts.push(extra);
    }
    const query = parts.join(", ");
    const candidates = await searchOsm(query);
    const anchor = areaPoint ?? home;
    const best = nearest(candidates, anchor);
    if (best && (!areaPoint || milesBetween(best, areaPoint) <= MAX_VENUE_FROM_AREA_MILES)) {
      return { ...best, source: "venue" };
    }
  }
  return areaPoint ? { ...areaPoint, source: "area" } : null;
}

let homeCache: { postcode: string; point: Point | null } | null = null;

/** Coordinates of HOME_POSTCODE, looked up once per server instance. */
export async function homePoint(): Promise<Point | null> {
  const postcode = process.env.HOME_POSTCODE?.trim();
  if (!postcode) return null;
  if (homeCache?.postcode !== postcode || !homeCache.point) {
    homeCache = { postcode, point: await lookupPostcode(postcode) };
  }
  return homeCache.point;
}

export function distanceFromHome(e: { lat: number | null; lng: number | null }, home: Point | null): number | null {
  if (!home || e.lat == null || e.lng == null) return null;
  return milesBetween(home, { lat: e.lat, lng: e.lng });
}
