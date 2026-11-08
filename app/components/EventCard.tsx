import Link from "next/link";
import { formatDateRange, formatTime } from "@/lib/dates";
import { formatMiles } from "@/lib/geo";
import type { EventRow } from "@/lib/types";

export default function EventCard({ e, miles, showDate = false }: { e: EventRow; miles?: number | null; showDate?: boolean }) {
  const time = e.start_time ? formatTime(e.start_time) + (e.end_time ? `–${formatTime(e.end_time)}` : "") : null;
  const multiDay = e.end_date && e.end_date !== e.start_date;
  return (
    <Link href={`/event/${e.id}`} className="group block overflow-hidden rounded-xl border border-line bg-card transition hover:border-accent">
      <div className="relative aspect-[4/5] overflow-hidden bg-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/image/${encodeURIComponent(e.thumb_file_id ?? e.file_id)}`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition group-hover:scale-[1.02]"
        />
        {miles != null && (
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
            {formatMiles(miles)}
          </span>
        )}
      </div>
      <div className="space-y-0.5 p-3">
        <h3 className="line-clamp-2 font-semibold leading-snug">{e.title}</h3>
        {(showDate || multiDay) && <p className="text-sm text-muted">{formatDateRange(e.start_date, e.end_date)}</p>}
        {time && <p className="text-sm text-muted">{time}</p>}
        {(e.area || e.venue) && <p className="line-clamp-1 text-sm text-muted">{e.area ?? e.venue}</p>}
        {e.price && <p className="text-sm font-medium text-accent">{e.price}</p>}
      </div>
    </Link>
  );
}
