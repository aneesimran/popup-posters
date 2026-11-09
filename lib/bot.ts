import * as db from "./db";
import { addDays, formatDateRange, formatTime, todayLondon } from "./dates";
import { dedupeKey } from "./dedupe";
import { extractPoster, parseDateReply } from "./gemini";
import { distanceFromHome, formatMiles, homePoint, locateEvent, type Point } from "./geo";
import {
  claimBatchNotice, enqueue, forgetUpload, queueLength, recordOutcome, runWorker, takeBatchTotals, touchActivity,
  type BatchTotals, type Outcome, type PosterJob,
} from "./queue";
import { downloadFile, escapeHtml as h, sendMessage, sendTyping, storeImage, type TgMessage, type TgUpdate } from "./telegram";
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
    if (msg.reply_to_message && text) await handleReply(msg, text);
    else if (text.startsWith("/list")) await handleList(chatId);
    else await sendMessage(chatId, HELP);
    await startWorker(origin); // also restarts the poster queue if it ever stalled
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
    await recordOutcome(chatId, "existing");
    await startWorker(origin); // sends the end-of-batch summary once things go quiet
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
  await touchActivity();
  if (added && (await queueLength()) >= BATCH_NOTICE_AT && (await claimBatchNotice())) {
    await sendMessage(chatId, "Got a batch! I'll read them one at a time (about 8 a minute) so I stay within the free limit. Replies will trickle in.");
  }
  await startWorker(origin);
}

/** Read queued posters. Only one worker runs at a time; extra calls return straight away. */
export async function startWorker(origin: string): Promise<void> {
  await runWorker({
    process: async (job) => {
      const outcome = await processPoster(job);
      await recordOutcome(job.chat_id, outcome, job.source === "upload");
    },
    giveUp: async (job) => {
      await recordOutcome(job.chat_id, "failed", job.source === "upload");
      if (job.source === "upload") {
        if (job.image_hash) await forgetUpload(job.image_hash); // so the next auto-import can try again
      } else {
        await sendMessage(job.chat_id, "Sorry, I couldn't read this poster after several tries. Send it again later.", job.message_id);
      }
    },
    onIdle: async () => {
      const totals = await takeBatchTotals();
      if (totals === "wait") return false;
      // Auto-imports always get a summary (they have no per-image replies); shared batches from 2 up.
      if (totals?.chat_id && (totals.uploaded > 0 || batchSize(totals) >= 2)) {
        await sendMessage(totals.chat_id, batchSummary(totals, origin));
      }
      return true;
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

const batchSize = (t: BatchTotals) => t.added + t.needs_date + t.existing + t.not_poster + t.failed;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "All done! 59 posters checked: 41 added, …" */
export function batchSummary(t: BatchTotals, origin: string): string {
  const added = t.added + t.needs_date;
  const auto = t.uploaded > 0;
  const allAuto = t.uploaded === batchSize(t);
  const noun = allAuto ? ["new image", "new images"] : ["poster", "posters"];
  const needsDate = t.needs_date
    ? auto
      ? ` (${t.needs_date} need${t.needs_date === 1 ? "s" : ""} a date: set it in the app or on the website)`
      : ` (${t.needs_date} need${t.needs_date === 1 ? "s" : ""} a date: reply to ${t.needs_date === 1 ? "its message" : "their messages"})`
    : "";
  const lines = [
    `<b>${allAuto ? "Auto-import" : "All done!"}</b> ${plural(batchSize(t), noun[0], noun[1])} checked:`,
    added ? `✅ ${added} added${needsDate}` : "",
    t.existing ? `🔁 ${plural(t.existing, "was already saved", "were already saved")}` : "",
    t.not_poster ? `🚫 ${plural(t.not_poster, "wasn't an event poster", "weren't event posters")}` : "",
    t.failed
      ? `⚠️ ${plural(t.failed, "couldn't be read", "couldn't be read")}, ${allAuto ? "will retry next import" : `send ${t.failed === 1 ? "it" : "them"} again later`}`
      : "",
    "",
    origin,
  ];
  return lines.filter((l, i) => l || i === lines.length - 2).join("\n");
}

/** The chat posters belong to (the bot owner's). */
export function ownerChatId(): number | null {
  const first = (process.env.ALLOWED_CHAT_ID ?? "").split(",")[0]?.trim();
  return first ? Number(first) : null;
}

type ProcessableJob = Pick<
  PosterJob,
  "chat_id" | "message_id" | "file_id" | "thumb_file_id" | "file_unique_id" | "caption"
> & Partial<Pick<PosterJob, "source" | "image_b64" | "mime">>;

/**
 * Read one poster and save it. Throws on Gemini/network errors so the queue can retry.
 * Images uploaded by the app are handled quietly: no reply per image (the batch summary covers
 * them), and only images that turn out to be posters are stored on Telegram.
 */
export async function processPoster(job: ProcessableJob): Promise<Outcome> {
  const chatId = job.chat_id;
  const quiet = job.source === "upload";
  const reply = (text: string) => (quiet ? Promise.resolve(null) : sendMessage(chatId, text, job.message_id));

  let bytes: Uint8Array;
  let mimeType: string;
  if (job.image_b64) {
    bytes = new Uint8Array(Buffer.from(job.image_b64, "base64"));
    mimeType = job.mime ?? "image/jpeg";
  } else {
    await sendTyping(chatId);
    ({ bytes, mimeType } = await downloadFile(job.file_id!));
  }
  const x = await extractPoster(bytes, mimeType, job.caption ?? undefined);

  if (!x.is_event || !x.title) {
    await reply("Doesn't look like an event poster, so I skipped it.");
    return "not_poster";
  }

  const key = dedupeKey(x.title, x.start_date);
  if (key) {
    const dup = await db.findByDedupeKey(key);
    if (dup) {
      await reply(`Already have this one:\n${summary(dup)}`);
      return "existing";
    }
  }

  // App uploads have no Telegram file yet: store the poster there now.
  const file = job.file_id
    ? { fileId: job.file_id, uniqueId: job.file_unique_id, thumbId: job.thumb_file_id ?? job.file_id }
    : await storeImage(chatId, bytes, mimeType);

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
    region: x.region,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    geo_source: geo?.source ?? null,
  });
  if (!row) {
    // Lost a race with an identical poster sent at the same moment.
    await reply("Already have this one.");
    return "existing";
  }

  const sent = await reply(
    row.status === "pending"
      ? `Added, but I couldn't find a date:\n${summary(row, home)}\n\n<b>Reply to this message with the date</b> (e.g. <i>Sat 14 Nov 6pm</i>).`
      : `Added:\n${summary(row, home)}`,
  );
  if (sent) await db.setBotMessage(row.id, sent.message_id);
  return row.status === "pending" ? "needs_date" : "added";
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
