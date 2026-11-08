import { after } from "next/server";
import { startWorker } from "@/lib/bot";
import { safeEqual } from "@/lib/auth";

export const maxDuration = 300;

/** Carries on reading queued posters in a fresh function call (called by the worker itself). */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!secret || !safeEqual(req.headers.get("x-queue-secret") ?? "", secret)) return new Response("Forbidden", { status: 403 });
  const origin = new URL(req.url).origin;
  after(() => startWorker(origin));
  return new Response("ok");
}
