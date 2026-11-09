import Link from "next/link";
import { notFound } from "next/navigation";
import DeleteButton from "./DeleteButton";
import EditForm from "./EditForm";
import { getEvent } from "@/lib/db";
import { formatDateRange, formatTime } from "@/lib/dates";
import { distanceFromHome, formatMiles, homePoint } from "@/lib/geo";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = Number.isInteger(Number(id)) ? await getEvent(Number(id)) : null;
  if (!e) notFound();

  const original = `/api/image/${encodeURIComponent(e.file_id)}`;
  const image = `${original}?w=1080`;
  const time = e.start_time ? formatTime(e.start_time) + (e.end_time ? `–${formatTime(e.end_time)}` : "") : null;
  const mapQuery = [e.venue, e.area, e.postcode].filter(Boolean).join(", ");
  const miles = distanceFromHome(e, await homePoint());

  return (
    <main>
      <header className="py-5">
        <Link href="/" className="text-sm text-accent">← All events</Link>
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        <a href={original} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line bg-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={`Poster for ${e.title}`} className="w-full" />
        </a>
        <div className="space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{e.title}</h1>
            <p className={e.start_date ? "" : "font-medium text-accent"}>
              {formatDateRange(e.start_date, e.end_date)}{time ? `, ${time}` : ""}
            </p>
            {mapQuery && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
                target="_blank"
                rel="noreferrer"
                className="block text-muted underline decoration-line underline-offset-4"
              >
                {mapQuery}
              </a>
            )}
            {miles != null && (
              <p className="text-sm text-muted">
                {formatMiles(miles)} from home{e.geo_source === "area" ? " (roughly; based on the area)" : ""}
              </p>
            )}
            {e.price && <p className="font-medium text-accent">{e.price}</p>}
            {e.description && <p className="pt-2 text-muted">{e.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {e.start_date && (
              <a href={`/api/events/${e.id}/ics`} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink">
                Add to calendar
              </a>
            )}
            <DeleteButton id={e.id} />
          </div>
          <details open={!e.start_date} className="rounded-xl border border-line bg-card p-4">
            <summary className="cursor-pointer font-medium">Edit details</summary>
            <div className="pt-4"><EditForm e={e} /></div>
          </details>
        </div>
      </div>
    </main>
  );
}
