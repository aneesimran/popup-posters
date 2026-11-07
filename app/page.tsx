import Link from "next/link";
import EventCard from "./components/EventCard";
import * as db from "@/lib/db";
import { dayLabel, todayLondon } from "@/lib/dates";
import type { EventRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const areaKey = (a: string | null) => a?.trim().toLowerCase() ?? "";

function groupByDay(events: EventRow[], today: string) {
  const groups = new Map<string, EventRow[]>();
  for (const e of events) {
    // Multi-day events that started already show under today.
    const day = e.start_date! < today ? today : e.start_date!;
    groups.set(day, [...(groups.get(day) ?? []), e]);
  }
  return [...groups.entries()];
}

export default async function Home({ searchParams }: { searchParams: Promise<{ area?: string; past?: string }> }) {
  const { area, past } = await searchParams;
  const showPast = past === "1";
  const today = todayLondon();
  const [events, pending] = await Promise.all([
    showPast ? db.pastEvents(today) : db.upcomingEvents(today),
    showPast ? Promise.resolve([]) : db.pendingEvents(),
  ]);

  const areas = new Map<string, string>();
  for (const e of events) if (e.area && !areas.has(areaKey(e.area))) areas.set(areaKey(e.area), e.area);
  const sortedAreas = [...areas.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const selected = area ? areaKey(area) : "";
  const shown = selected ? events.filter((e) => areaKey(e.area) === selected) : events;

  const href = (params: { area?: string; past?: boolean }) => {
    const q = new URLSearchParams();
    if (params.area) q.set("area", params.area);
    if (params.past) q.set("past", "1");
    const s = q.toString();
    return s ? `/?${s}` : "/";
  };

  const chip = (label: string, active: boolean, to: string) => (
    <Link
      key={label}
      href={to}
      className={`shrink-0 rounded-full border px-3 py-1 text-sm ${active ? "border-accent bg-accent text-accent-ink" : "border-line bg-card text-ink"}`}
    >
      {label}
    </Link>
  );

  return (
    <main>
      <header className="flex items-baseline justify-between py-5">
        <h1 className="text-2xl font-semibold">Popup Posters</h1>
        <Link href={href({ area, past: !showPast })} className="text-sm text-accent">
          {showPast ? "Upcoming" : "Past events"}
        </Link>
      </header>

      {sortedAreas.length > 1 && (
        <nav className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1">
          {chip("All areas", !selected, href({ past: showPast }))}
          {sortedAreas.map(([key, label]) => chip(label, selected === key, href({ area: label, past: showPast })))}
        </nav>
      )}

      {pending.length > 0 && (
        <section className="mb-8 rounded-xl border border-dashed border-accent/60 p-4">
          <h2 className="mb-1 font-semibold">Needs a date</h2>
          <p className="mb-3 text-sm text-muted">Reply to the bot's message with the date, or tap one to edit it here.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {pending.map((e) => <EventCard key={e.id} e={e} />)}
          </div>
        </section>
      )}

      {shown.length === 0 ? (
        <p className="mt-16 text-center text-muted">
          {showPast ? "No past events yet." : "No upcoming events. Share a poster to your Telegram bot to add one."}
        </p>
      ) : showPast ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((e) => <EventCard key={e.id} e={e} showDate />)}
        </div>
      ) : (
        groupByDay(shown, today).map(([day, items]) => (
          <section key={day} className="mb-8">
            <h2 className="sticky top-0 z-10 -mx-4 mb-3 bg-bg/90 px-4 py-2 text-lg font-semibold backdrop-blur">{dayLabel(day, today)}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((e) => <EventCard key={e.id} e={e} />)}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
