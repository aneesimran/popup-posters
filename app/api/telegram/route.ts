import { after } from "next/server";
import { handleUpdate } from "@/lib/bot";
import { safeEqual } from "@/lib/auth";
import type { TgUpdate } from "@/lib/telegram";

export const maxDuration = 120;

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(got, secret)) return new Response("Forbidden", { status: 403 });

  const update = (await req.json()) as TgUpdate;
  // Answer Telegram straight away so it doesn't retry; read the poster afterwards.
  after(() => handleUpdate(update));
  return new Response("ok");
}
