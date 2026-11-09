import { neon } from "@neondatabase/serverless";
import type { EventRow } from "./types";

let client: ReturnType<typeof neon> | null = null;
const sql = () => (client ??= neon(process.env.DATABASE_URL!));

type NewEvent = Omit<EventRow, "id" | "created_at" | "bot_msg_id">;

export async function insertEvent(e: NewEvent): Promise<EventRow | null> {
  // dedupe_key is unique; a clash means we already have this event.
  const rows = (await sql()`
    insert into events (title, start_date, end_date, start_time, end_time, venue, area, price, description,
                        file_id, thumb_file_id, file_unique_id, chat_id, status, dedupe_key,
                        postcode, region, lat, lng, geo_source)
    values (${e.title}, ${e.start_date}, ${e.end_date}, ${e.start_time}, ${e.end_time}, ${e.venue}, ${e.area},
            ${e.price}, ${e.description}, ${e.file_id}, ${e.thumb_file_id}, ${e.file_unique_id}, ${e.chat_id},
            ${e.status}, ${e.dedupe_key}, ${e.postcode}, ${e.region}, ${e.lat}, ${e.lng}, ${e.geo_source})
    on conflict (dedupe_key) do nothing
    returning *`) as EventRow[];
  return rows[0] ?? null;
}

export async function findByDedupeKey(key: string): Promise<EventRow | null> {
  const rows = (await sql()`select * from events where dedupe_key = ${key} limit 1`) as EventRow[];
  return rows[0] ?? null;
}

export async function findByFileUniqueId(id: string): Promise<EventRow | null> {
  const rows = (await sql()`select * from events where file_unique_id = ${id} limit 1`) as EventRow[];
  return rows[0] ?? null;
}

export async function findByBotMessage(chatId: number, botMsgId: number): Promise<EventRow | null> {
  const rows = (await sql()`
    select * from events where chat_id = ${chatId} and bot_msg_id = ${botMsgId} limit 1`) as EventRow[];
  return rows[0] ?? null;
}

export async function setBotMessage(id: number, botMsgId: number) {
  await sql()`update events set bot_msg_id = ${botMsgId} where id = ${id}`;
}

export async function getEvent(id: number): Promise<EventRow | null> {
  const rows = (await sql()`select * from events where id = ${id}`) as EventRow[];
  return rows[0] ?? null;
}

export async function deleteEvent(id: number) {
  await sql()`delete from events where id = ${id}`;
}

export type EventUpdate = Pick<
  EventRow,
  "title" | "start_date" | "end_date" | "start_time" | "end_time" | "venue" | "area" | "price" | "description" | "status" | "dedupe_key"
  | "postcode" | "region" | "lat" | "lng" | "geo_source"
>;

/** Returns false if the new dedupe_key clashes with another event. */
export async function updateEvent(id: number, u: EventUpdate): Promise<boolean> {
  try {
    await sql()`
      update events set title = ${u.title}, start_date = ${u.start_date}, end_date = ${u.end_date},
        start_time = ${u.start_time}, end_time = ${u.end_time}, venue = ${u.venue}, area = ${u.area},
        price = ${u.price}, description = ${u.description}, status = ${u.status}, dedupe_key = ${u.dedupe_key},
        postcode = ${u.postcode}, region = ${u.region}, lat = ${u.lat}, lng = ${u.lng}, geo_source = ${u.geo_source}
      where id = ${id}`;
    return true;
  } catch (err) {
    if (String(err).includes("events_dedupe_key")) return false;
    throw err;
  }
}

/** Events still running on or after `today` (multi-day events count until their end date). */
export async function upcomingEvents(today: string): Promise<EventRow[]> {
  return (await sql()`
    select * from events
    where status = 'active' and coalesce(end_date, start_date) >= ${today}
    order by start_date, start_time nulls last, title`) as EventRow[];
}

export async function pastEvents(today: string): Promise<EventRow[]> {
  return (await sql()`
    select * from events
    where status = 'active' and coalesce(end_date, start_date) < ${today}
    order by start_date desc, start_time nulls last
    limit 200`) as EventRow[];
}

export async function pendingEvents(): Promise<EventRow[]> {
  return (await sql()`select * from events where status = 'pending' order by created_at desc`) as EventRow[];
}

export async function eventsBetween(from: string, to: string): Promise<EventRow[]> {
  return (await sql()`
    select * from events
    where status = 'active' and coalesce(end_date, start_date) >= ${from} and start_date <= ${to}
    order by start_date, start_time nulls last`) as EventRow[];
}

export async function setLocation(id: number, geo: { lat: number; lng: number; source: string } | null) {
  await sql()`update events set lat = ${geo?.lat ?? null}, lng = ${geo?.lng ?? null}, geo_source = ${geo?.source ?? null} where id = ${id}`;
}

export async function eventsMissingLocation(): Promise<EventRow[]> {
  return (await sql()`select * from events where lat is null and (venue is not null or area is not null or postcode is not null)`) as EventRow[];
}

export async function allEvents(): Promise<EventRow[]> {
  return (await sql()`select * from events order by id`) as EventRow[];
}

export async function setRegion(id: number, region: string) {
  await sql()`update events set region = ${region} where id = ${id}`;
}
