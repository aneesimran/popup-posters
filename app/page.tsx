import Link from "next/link";
import EventCard from "./components/EventCard";
import * as db from "@/lib/db";
import { dayLabel, todayLondon } from "@/lib/dates";
import { WHEN_OPTIONS, WITHIN_OPTIONS, overlaps, parseWhen, parseWithin, whenRange } from "@/lib/filters";
import { distanceFromHome, homePoint } from "@/lib/geo";
import type { EventRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { area?: string; past?: string; when?: string; within?: string; sort?: string };
type Item = { e: EventRow; miles: number | null };

const areaKey = (a: string | null) => a?.trim().toLowerCase() ?? "";

function groupByDay(items: Item[], today: string) {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    // Multi-day events that started already show under today.
    const day = item.e.start_date! < today ? today : item.e.start_date!;
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return [...groups.entries()];
}

function Chip({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`shrink-0 rounded-full border px-3 py-1 text-sm ${active ? "border-accent bg-accent text-accent-ink" : "border-line bg-card text-ink"}`}
    >
      {label}
    </Link>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="chip-row -mx-4 flex gap-2 overflow-x-auto px-4">{children}</div>;
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
);

export default async function Home({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const showPast = params.past === "1";
  const when = showPast ? null : parseWhen(params.when);
  const within = parseWithin(params.within);
  const nearestFirst = params.sort === "near";
  const today = todayLondon();

  const [events, pending, home] = await Promise.all([
    showPast ? db.pastEvents(today) : db.upcomingEvents(today),
    showPast ? Promise.resolve([]) : db.pendingEvents(),
    homePoint(),
  ]);

  const withMiles = (e: EventRow): Item => ({ e, miles: distanceFromHome(e, home) });
  const all = events.map(withMiles);

  const areas = new Map<string, string>();
  for (const { e } of all) if (e.area && !areas.has(areaKey(e.area))) areas.set(areaKey(e.area), e.area);
  const sortedAreas = [...areas.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const selectedArea = params.area ? areaKey(params.area) : "";

  let shown = all;
  if (selectedArea) shown = shown.filter(({ e }) => areaKey(e.area) === selectedArea);
  if (when) {
    const range = whenRange(when, today);
    shown = shown.filter(({ e }) => overlaps(e, range));
  }
  const unlocated = within ? shown.filter((i) => i.miles == null).length : 0;
  if (within) shown = shown.filter((i) => i.miles != null && i.miles <= within);
  if (nearestFirst) shown = [...shown].sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity));

  const href = (change: Partial<Params>) => {
    const next = { ...params, ...change };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/?${s}` : "/";
  };

  const hasDistances = !!home && all.some((i) => i.miles != null);
  const filtered = !!(selectedArea || when || within);

  return (
    <main>
      <header className="flex items-baseline justify-between py-5">
        <h1 className="text-2xl font-semibold">Popup Posters</h1>
        <Link href={showPast ? "/" : "/?past=1"} className="text-sm text-accent">
          {showPast ? "Upcoming" : "Past events"}
        </Link>
      </header>

      <nav className="mb-6 space-y-2">
        {!showPast && (
          <ChipRow>
            <Chip label="Any time" active={!when} href={href({ when: undefined })} />
            {WHEN_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} active={when === o.value} href={href({ when: o.value })} />
            ))}
          </ChipRow>
        )}
        {hasDistances && (
          <ChipRow>
            <Chip label="Any distance" active={!within} href={href({ within: undefined })} />
            {WITHIN_OPTIONS.map((m) => (
              <Chip key={m} label={`Within ${m} mi`} active={within === m} href={href({ within: String(m) })} />
            ))}
            <Chip
              label={nearestFirst ? "Nearest first ✓" : "Nearest first"}
              active={nearestFirst}
              href={href({ sort: nearestFirst ? undefined : "near" })}
            />
          </ChipRow>
        )}
        {sortedAreas.length > 1 && (
          <ChipRow>
            <Chip label="All areas" active={!selectedArea} href={href({ area: undefined })} />
            {sortedAreas.map(([key, label]) => (
              <Chip key={key} label={label} active={selectedArea === key} href={href({ area: label })} />
            ))}
          </ChipRow>
        )}
      </nav>

      {pending.length > 0 && !filtered && (
        <section className="mb-8 rounded-xl border border-dashed border-accent/60 p-4">
          <h2 className="mb-1 font-semibold">Needs a date</h2>
          <p className="mb-3 text-sm text-muted">Reply to the bot&apos;s message with the date, or tap one to edit it here.</p>
          <Grid>{pending.map((e) => <EventCard key={e.id} e={e} miles={distanceFromHome(e, home)} />)}</Grid>
        </section>
      )}

      {shown.length === 0 ? (
        <p className="mt-16 text-center text-muted">
          {filtered
            ? "Nothing matches these filters."
            : showPast
              ? "No past events yet."
              : "No upcoming events. Share a poster to your Telegram bot to add one."}
        </p>
      ) : showPast || nearestFirst ? (
        <Grid>{shown.map(({ e, miles }) => <EventCard key={e.id} e={e} miles={miles} showDate />)}</Grid>
      ) : (
        groupByDay(shown, today).map(([day, items]) => (
          <section key={day} className="mb-8">
            <h2 className="sticky top-0 z-10 -mx-4 mb-3 bg-bg/90 px-4 py-2 text-lg font-semibold backdrop-blur">{dayLabel(day, today)}</h2>
            <Grid>{items.map(({ e, miles }) => <EventCard key={e.id} e={e} miles={miles} />)}</Grid>
          </section>
        ))
      )}

      {unlocated > 0 && (
        <p className="mt-6 text-center text-sm text-muted">
          {unlocated} event{unlocated === 1 ? "" : "s"} without a known location {unlocated === 1 ? "is" : "are"} hidden. Add a postcode or area on the event page to include {unlocated === 1 ? "it" : "them"}.
        </p>
      )}
    </main>
  );
}
