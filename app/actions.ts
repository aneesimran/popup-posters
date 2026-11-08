"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";
import * as db from "@/lib/db";
import { isValidDate, isValidTime } from "@/lib/dates";
import { dedupeKey } from "@/lib/dedupe";
import { homePoint, locateEvent, normalizePostcode } from "@/lib/geo";

async function requireSession() {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value ?? "";
  if (!process.env.APP_PASSCODE || !safeEqual(value, await sessionToken())) redirect("/login");
}

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const passcode = String(form.get("passcode") ?? "");
  const expected = process.env.APP_PASSCODE ?? "";
  if (!expected || !safeEqual(passcode, expected)) return "Wrong passcode.";
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}

const text = (form: FormData, key: string) => {
  const v = String(form.get(key) ?? "").trim();
  return v || null;
};

export async function saveEvent(id: number, _prev: string | null, form: FormData): Promise<string | null> {
  await requireSession();
  const title = text(form, "title");
  if (!title) return "Title is required.";
  const start_date = text(form, "start_date");
  const end_date = text(form, "end_date");
  const start_time = text(form, "start_time");
  const end_time = text(form, "end_time");
  if (start_date && !isValidDate(start_date)) return "Start date looks wrong.";
  if (end_date && (!isValidDate(end_date) || !start_date || end_date < start_date)) return "End date must be on or after the start date.";
  if (start_time && !isValidTime(start_time)) return "Start time looks wrong.";
  if (end_time && !isValidTime(end_time)) return "End time looks wrong.";

  const existing = await db.getEvent(id);
  if (!existing) return "This event no longer exists.";
  const rawPostcode = text(form, "postcode");
  const postcode = rawPostcode ? normalizePostcode(rawPostcode) : null;
  if (rawPostcode && !postcode) return "Postcode looks wrong.";
  const venue = text(form, "venue");
  const area = text(form, "area");

  // Only look the location up again if something about it changed.
  let geo = { lat: existing.lat, lng: existing.lng, geo_source: existing.geo_source };
  if (venue !== existing.venue || area !== existing.area || postcode !== existing.postcode || existing.lat == null) {
    const found = await locateEvent({ postcode, venue, area }, await homePoint()).catch(() => null);
    geo = { lat: found?.lat ?? null, lng: found?.lng ?? null, geo_source: found?.source ?? null };
  }

  const ok = await db.updateEvent(id, {
    title,
    start_date,
    end_date: end_date === start_date ? null : end_date,
    start_time,
    end_time: start_time ? end_time : null,
    venue,
    area,
    postcode,
    ...geo,
    price: text(form, "price"),
    description: text(form, "description"),
    status: start_date ? "active" : "pending",
    dedupe_key: dedupeKey(title, start_date),
  });
  if (!ok) return "Another event already has this title and date.";
  revalidatePath("/");
  redirect(`/event/${id}`);
}

export async function removeEvent(id: number) {
  await requireSession();
  await db.deleteEvent(id);
  revalidatePath("/");
  redirect("/");
}
