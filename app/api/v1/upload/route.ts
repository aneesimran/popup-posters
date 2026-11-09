import { after } from "next/server";
import { hasApiKey } from "@/lib/auth";
import { json } from "@/lib/api";
import { ownerChatId, startWorker } from "@/lib/bot";
import { enqueueUpload, touchActivity } from "@/lib/queue";
import { MAX_UPLOAD_BYTES, sha256Hex, sniffImageType } from "@/lib/upload";

export const maxDuration = 300;

/**
 * The Android app's auto-import sends one image per request (raw bytes as the body).
 * New images join the poster queue; images seen before are skipped by fingerprint.
 */
export async function POST(req: Request) {
  if (!hasApiKey(req)) return json({ error: "unauthorized" }, 401);
  const chatId = ownerChatId();
  if (!chatId) return json({ error: "ALLOWED_CHAT_ID is not set" }, 503);

  const image = new Uint8Array(await req.arrayBuffer());
  if (image.length === 0 || image.length > MAX_UPLOAD_BYTES) return json({ error: "image missing or too large" }, 413);
  const mime = sniffImageType(image);
  if (!mime) return json({ error: "not a JPEG, PNG or WebP image" }, 415);

  const hash = await sha256Hex(image);
  const queued = await enqueueUpload({ chat_id: chatId, image, mime, hash });
  if (!queued) return json({ status: "duplicate" });

  await touchActivity();
  const origin = new URL(req.url).origin;
  after(() => startWorker(origin).catch((err) => console.error("queue kick failed", err)));
  return json({ status: "queued" });
}
