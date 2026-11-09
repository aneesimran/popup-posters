import { WHEN_OPTIONS, WITHIN_OPTIONS, whenLabel } from "./filters";
import type { ListItem } from "./listing";

/** Event as the Android app sees it. */
export type ApiEvent = {
  id: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  area: string | null;
  region: string | null;
  postcode: string | null;
  price: string | null;
  description: string | null;
  status: "active" | "pending";
  miles: number | null;
  createdAt: string;
  imageUrl: string;
  thumbUrl: string;
  webUrl: string;
};

export function toApiEvent({ e, miles }: ListItem, origin: string): ApiEvent {
  const image = (id: string) => `${origin}/api/image/${encodeURIComponent(id)}`;
  return {
    id: e.id,
    title: e.title,
    startDate: e.start_date,
    endDate: e.end_date,
    startTime: e.start_time,
    endTime: e.end_time,
    venue: e.venue,
    area: e.area,
    region: e.region,
    postcode: e.postcode,
    price: e.price,
    description: e.description,
    status: e.status,
    miles: miles == null ? null : Math.round(miles * 10) / 10,
    createdAt: new Date(e.created_at).toISOString(),
    imageUrl: image(e.file_id),
    thumbUrl: image(e.thumb_file_id ?? e.file_id),
    webUrl: `${origin}/event/${e.id}`,
  };
}

export function filterOptions(today: string) {
  return {
    when: WHEN_OPTIONS.map((o) => ({ value: o.value, label: whenLabel(o.value, today) })),
    within: [...WITHIN_OPTIONS],
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
