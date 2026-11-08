import * as db from "./db";
import { addDays, formatDateRange, formatTime, todayLondon } from "./dates";
import { dedupeKey } from "./dedupe";
import { extractPoster, parseDateReply } from "./gemini";
import { distanceFromHome, formatMiles, homePoint, locateEvent, type Point } from "./geo";
import { claimBatchNotice, enqueue, queueLength, runWorker, type PosterJob } from "./queue";
import { downloadFile, escapeHtml as h, sendMessage, sendTyping, type TgMessage, type TgUpdate } from "./telegram";
import type { EventRow } from "./types";

const HELP = [
  "Share event posters to me and I'll add them to your list.",
  "",
  "• Reply to one of my messages with a date (e.g. <i>next Sat 2pm</i>) to set or change it",
  "• Reply with /delete to remove that event",
  "• /list shows the next 7 days",
].join("\n");

type Summarisable = Pick<EventRow, "title" | "start_date" | "end_date" | "start_time" | "end_time" | "venue" | "area" | "price"> &
  Partial<Pick<EventRow, "lat" | "lng">>;

export function summary(e: Summarisable, home: Point | null = null): string {
  const when = [formatDateRange(e.start_date, e.end_date), e.start_time ? formatTime(e.start_time) + (e.end_time ? `–${formatTime(e.end_time)}` : "") : ""]
    .filter(Boolean)
    .join(", ");
  const where = [e.venue, e.area && !e.venue?.includes(e.area) ? e.area : null].filter(Boolean).join(", ");
  const miles = distanceFromHome({ lat: e.lat ?? null, lng: e.lng ?? null }, home);
  const whereLine = [where, miles != null ? `${formatMiles(miles)} from home` : ""].filter(Boolean).join(" · ");
  return [`<b>${h(e.title)}</b>`, h(when), whereLine && h(whereLine), e.price && h(e.price)].filter(Boolean).join("\n");
}

function isAllowed(chatId: number): boolean {
  const allowed = process.env.ALLOWED_CHAT_ID;
  return !!allowed && allowed.split(",").map((s) => s.trim()).includes(String(chatId));
}

/** Pick the poster image from a message: the largest photo, or an image sent as a file. */
function posterFile(msg: TgMessage) {
  if (msg.photo?.length) {
    const sizes = [...msg.photo].sort((a, b) => a.width - b.width);
    const full = sizes[sizes.length - 1];
    const thumb = sizes.find((s) => s.width >= 480) ?? full;
    return { fileId: full.file_id, uniqueId: full.file_unique_id, thumbId: thumb.file_id };
  }
  if (msg.document?.mime_type?.startsWith("image/")) {
    return { fileId: msg.document.file_id, uniqueId: msg.document.file_unique_id, thumbId: msg.document.file_id };
  }
  return null;
}

/** `origin` is this app's URL, used to hand queue work over to a fresh function call. */
export async function handleUpdate(update: TgUpdate, origin: string): Promise<void> {
  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? "";

  if (!isAllowed(chatId)) {
    // Let the owner discover their chat ID during setup; ignore everyone else.
    if (text.startsWith("/start") && !process.env.ALLOWED_CHAT_ID) {
      await sendMessage(chatId, `Your chat ID is <code>${chatId}</code>. Set it as ALLOWED_CHAT_ID in Vercel and redeploy.`);
    }
    return;
  }

  try {
    const file = posterFile(msg);
    if (file) return await queuePoster(msg, file, origin);
    if (msg.reply_to_message && text) return await handleReply(msg, text);
    if (text.startsWith("/list")) return await handleList(chatId);
    await sendMessage(chatId, HELP);
  } catch (err) {
    console.error("bot error", err);
    const quota = /429|quota|RESOURCE_EXHAUSTED/i.test(String(err));
    await sendMessage(
      chatId,
      quota ? "Gemini's free limit is used up for now. Try again in a minute." : "Something went wrong with that. Try sending it again.",
      msg.message_id,
    ).catch(() => {});
  }
}

const BATCH_NOTICE_AT = 5;

async function queuePoster(msg: TgMessage, file: { fileId: string; uniqueId: string; thumbId: string }, origin: string) {
  const chatId = msg.chat.id;
  // Exact same image as a saved event: answer straight away, no need to read it again.
  const same = await db.findByFileUniqueId(file.uniqueId);
  if (same) {
    await sendMessage(chatId, `Already have this one:\n${summary(same)}`, msg.message_id);
    return;
  }

  const added = await enqueue({
    chat_id: chatId,
    message_id: msg.message_id,
    file_id: file.fileId,
    thumb_file_id: file.thumbId,
    file_unique_id: file.uniqueId,
    caption: msg.caption ?? null,
  });
  if (added && (await queueLength()) >= BATCH_NOTICE_AT && (await claimBatchNotice())) {
    await sendMessage(chatId, "Got a batch! I'll read them one at a time (about 8 a minute) so I stay within the free limit. Replies will trickle in.");
  }
  await startWorker(origin);
}

/** Read queued posters. Only one worker runs at a time; extra calls return straight away. */
export async function startWorker(origin: string): Promise<void> {
  await runWorker({
    process: processPoster,
    giveUp: async (job) => {
      await sendMessage(job.chat_id, "Sorry, I couldn't read this poster after several tries. Send it again later.", job.message_id);
    },
    handOver: async () => {
      await fetch(`${origin}/api/queue/run`, {
        method: "POST",
        headers: { "x-queue-secret": process.env.TELEGRAM_WEBHOOK_SECRET ?? "" },
        signal: AbortSignal.timeout(10_000),
      });
    },
  });
}

/** Read one poster and save it. Throws on Gemini/network errors so the queue can retry. */
export async function processPoster(job: Pick<PosterJob, "chat_id" | "message_id" | "file_id" | "thumb_file_id" | "file_unique_id" | "caption">) {
  const chatId = job.chat_id;
  const file = { fileId: job.file_id, uniqueId: job.file_unique_id, thumbId: job.thumb_file_id ?? job.file_id };
  const msg = { message_id: job.message_id };

  await sendTyping(chatId);
  const { bytes, mimeType } = await downloadFile(file.fileId);
  const x = await extractPoster(bytes, mimeType, job.caption ?? undefined);

  if (!x.is_event || !x.title) {
    await sendMessage(chatId, "Doesn't look like an event poster, so I skipped it.", msg.message_id);
    return;
  }

  const key = dedupeKey(x.title, x.start_date);
  if (key) {
    const dup = await db.findByDedupeKey(key);
    if (dup) {
      await sendMessage(chatId, `Already have this one:\n${summary(dup)}`, msg.message_id);
      return;
    }
  }

  const home = await homePoint();
  const geo = await locateEvent(x, home).catch(() => null);

  const row = await db.insertEvent({
    title: x.title,
    start_date: x.start_date,
    end_date: x.end_date,
    start_time: x.start_time,
    end_time: x.end_time,
    venue: x.venue,
    area: x.area,
    price: x.price,
    description: x.description,
    file_id: file.fileId,
    thumb_file_id: file.thumbId,
    file_unique_id: file.uniqueId,
    chat_id: chatId,
    status: x.start_date ? "active" : "pending",
    dedupe_key: key,
    postcode: x.postcode,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    geo_source: geo?.source ?? null,
  });
  if (!row) {
    // Lost a race with an identical poster sent at the same moment.
    await sendMessage(chatId, "Already have this one.", msg.message_id);
    return;
  }

  const reply = row.status === "pending"
    ? `Added, but I couldn't find a date:\n${summary(row, home)}\n\n<b>Reply to this message with the date</b> (e.g. <i>Sat 14 Nov 6pm</i>).`
    : `Added:\n${summary(row, home)}`;
  const sent = await sendMessage(chatId, reply, msg.message_id);
  await db.setBotMessage(row.id, sent.message_id);
}

async function handleReply(msg: TgMessage, text: string) {
  const chatId = msg.chat.id;
  const event = await db.findByBotMessage(chatId, msg.reply_to_message!.message_id);
  if (!event) {
    await sendMessage(chatId, "Reply to one of my “Added” messages to change that event.", msg.message_id);
    return;
  }

  if (text.startsWith("/delete")) {
    await db.deleteEvent(event.id);
    await sendMessage(chatId, `Deleted <b>${h(event.title)}</b>.`, msg.message_id);
    return;
  }

  const d = await parseDateReply(text, event.title);
  if (!d.start_date) {
    await sendMessage(chatId, "I couldn't work out a date from that. Try something like <i>Sat 14 Nov 6pm</i>.", msg.message_id);
    return;
  }

  const updated = {
    ...event,
    start_date: d.start_date,
    end_date: d.end_date,
    start_time: d.start_time ?? event.start_time,
    end_time: d.start_time ? d.end_time : event.end_time,
    status: "active" as const,
    dedupe_key: dedupeKey(event.title, d.start_date),
  };
  const ok = await db.updateEvent(event.id, updated);
  if (!ok) {
    await db.deleteEvent(event.id);
    await sendMessage(chatId, "That makes it a duplicate of an event I already have, so I removed this copy.", msg.message_id);
    return;
  }
  const sent = await sendMessage(chatId, `Updated:\n${summary(updated, await homePoint())}`, msg.message_id);
  await db.setBotMessage(event.id, sent.message_id);
}

async function handleList(chatId: number) {
  const today = todayLondon();
  const events = await db.eventsBetween(today, addDays(today, 6));
  if (!events.length) {
    await sendMessage(chatId, "Nothing in the next 7 days.");
    return;
  }
  const home = await homePoint();
  await sendMessage(chatId, events.map((e) => summary(e, home)).join("\n\n"));
}
