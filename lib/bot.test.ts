import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow, Extraction } from "./types";

// In-memory stand-ins for the database, Telegram and Gemini.
const rows: EventRow[] = [];
const sent: { chatId: number; text: string }[] = [];
let extraction: Extraction;
let dateReply = { start_date: "2026-11-21", end_date: null, start_time: "14:00", end_time: null };

vi.mock("./db", () => ({
  findByFileUniqueId: async (id: string) => rows.find((r) => r.file_unique_id === id) ?? null,
  findByDedupeKey: async (k: string) => rows.find((r) => r.dedupe_key === k) ?? null,
  findByBotMessage: async (c: number, m: number) => rows.find((r) => r.chat_id === c && r.bot_msg_id === m) ?? null,
  insertEvent: async (e: EventRow) => {
    const row = { ...e, id: rows.length + 1, bot_msg_id: null, created_at: "" } as EventRow;
    rows.push(row);
    return row;
  },
  setBotMessage: async (id: number, m: number) => { rows.find((r) => r.id === id)!.bot_msg_id = m; },
  updateEvent: async (id: number, u: Partial<EventRow>) => {
    if (u.dedupe_key && rows.some((r) => r.id !== id && r.dedupe_key === u.dedupe_key)) return false;
    Object.assign(rows.find((r) => r.id === id)!, u);
    return true;
  },
  deleteEvent: async (id: number) => { rows.splice(rows.findIndex((r) => r.id === id), 1); },
  eventsBetween: async () => rows.filter((r) => r.status === "active"),
}));
vi.mock("./telegram", () => ({
  sendMessage: async (chatId: number, text: string) => { sent.push({ chatId, text }); return { message_id: 1000 + sent.length }; },
  sendTyping: async () => {},
  downloadFile: async () => ({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }),
  escapeHtml: (s: string) => s,
  storeImage: async () => {
    stored.push(1);
    return { fileId: "stored-file", uniqueId: "stored-unique", thumbId: "stored-thumb" };
  },
}));
vi.mock("./geo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./geo")>()),
  homePoint: async () => ({ lat: 51.5416, lng: -0.0033 }), // Stratford station
  locateEvent: async () => ({ lat: 51.5590, lng: 0.0741, source: "venue" }), // Ilford Town Hall
}));
// Queue stand-in: posters are read straight away, in order, like the real worker does.
const outcomes: string[] = [];
const stored: number[] = [];
const jobs: Parameters<typeof import("./queue").enqueue>[0][] = [];
vi.mock("./queue", () => ({
  enqueue: async (job: (typeof jobs)[number]) => {
    if (jobs.some((j) => j.file_unique_id === job.file_unique_id)) return false;
    jobs.push(job);
    return true;
  },
  queueLength: async () => jobs.length,
  claimBatchNotice: async () => false,
  touchActivity: async () => {},
  recordOutcome: async (_chat: number, o: string) => { outcomes.push(o); },
  takeBatchTotals: async () => null,
  runWorker: async (h: { process: (j: unknown) => Promise<void>; onIdle: () => Promise<boolean> }) => {
    while (jobs.length) await h.process(jobs.shift());
    await h.onIdle();
  },
}));
vi.mock("./gemini", () => ({
  extractPoster: async () => extraction,
  parseDateReply: async () => dateReply,
}));

const { handleUpdate } = await import("./bot");

const ME = 42;
const ORIGIN = "http://test";
let nextId = 1;
const photo = (uid: string) => ({
  update_id: nextId,
  message: { message_id: nextId++, chat: { id: ME, type: "private" }, photo: [{ file_id: `f-${uid}`, file_unique_id: uid, width: 1080, height: 1350 }] },
});
const text = (t: string, replyTo?: number) => ({
  update_id: nextId,
  message: {
    message_id: nextId++, chat: { id: ME, type: "private" }, text: t,
    ...(replyTo ? { reply_to_message: { message_id: replyTo, chat: { id: ME, type: "private" } } } : {}),
  },
});
const event = (over: Partial<Extraction> = {}): Extraction => ({
  is_event: true, title: "Winter Night Market", start_date: "2026-11-14", end_date: null, start_time: "18:00",
  end_time: null, venue: "Ilford Town Hall", area: "Ilford", price: "Free", description: null, postcode: null, region: "London", ...over,
});
const last = () => sent[sent.length - 1].text;

beforeEach(() => {
  rows.length = 0;
  sent.length = 0;
  outcomes.length = 0;
  stored.length = 0;
  process.env.ALLOWED_CHAT_ID = String(ME);
});

describe("handleUpdate", () => {
  it("adds a poster and confirms it", async () => {
    extraction = event();
    await handleUpdate(photo("a"), ORIGIN);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", area: "Ilford", bot_msg_id: 1001, geo_source: "venue" });
    expect(last()).toContain("Added:");
    expect(last()).toMatch(/Ilford Town Hall · \d\.\d mi from home/);
    expect(last()).toContain("Sat 14 Nov, 6pm");
  });

  it("skips non-events", async () => {
    extraction = event({ is_event: false });
    await handleUpdate(photo("meme"), ORIGIN);
    expect(rows).toHaveLength(0);
    expect(last()).toContain("Doesn't look like an event");
    expect(outcomes).toEqual(["not_poster"]);
  });

  it("spots the same image and the same event in a different image", async () => {
    extraction = event();
    await handleUpdate(photo("a"), ORIGIN);
    await handleUpdate(photo("a"), ORIGIN);
    expect(last()).toContain("Already have this one");
    extraction = event({ title: "WINTER NIGHT MARKET!" });
    await handleUpdate(photo("b"), ORIGIN);
    expect(last()).toContain("Already have this one");
    expect(rows).toHaveLength(1);
    expect(outcomes).toEqual(["added", "existing", "existing"]);
  });

  it("asks for a date, then fills it in from a reply", async () => {
    extraction = event({ start_date: null, start_time: null });
    await handleUpdate(photo("nodate"), ORIGIN);
    expect(rows[0].status).toBe("pending");
    expect(outcomes).toEqual(["needs_date"]);
    expect(last()).toContain("Reply to this message with the date");
    await handleUpdate(text("next sat 2pm", rows[0].bot_msg_id!), ORIGIN);
    expect(rows[0]).toMatchObject({ status: "active", start_date: "2026-11-21", start_time: "14:00" });
    expect(last()).toContain("Updated:");
  });

  it("deletes an event when you reply /delete", async () => {
    extraction = event();
    await handleUpdate(photo("a"), ORIGIN);
    await handleUpdate(text("/delete", rows[0].bot_msg_id!), ORIGIN);
    expect(rows).toHaveLength(0);
    expect(last()).toContain("Deleted");
  });

  it("ignores other people, and tells the owner their chat ID during setup", async () => {
    extraction = event();
    const stranger = photo("x");
    stranger.message.chat.id = 7;
    await handleUpdate(stranger, ORIGIN);
    expect(rows).toHaveLength(0);
    expect(sent).toHaveLength(0);

    delete process.env.ALLOWED_CHAT_ID;
    await handleUpdate(text("/start"), ORIGIN);
    expect(last()).toContain(`<code>${ME}</code>`);
  });
});

describe("batchSummary", async () => {
  const { batchSummary } = await import("./bot");
  it("sums up a batch, leaving out empty lines", () => {
    const text = batchSummary({ chat_id: 1, added: 40, needs_date: 1, existing: 12, not_poster: 5, failed: 0, uploaded: 0 }, "https://x.app");
    expect(text).toBe([
      "<b>All done!</b> 58 posters checked:",
      "✅ 41 added (1 needs a date: reply to its message)",
      "🔁 12 were already saved",
      "🚫 5 weren't event posters",
      "",
      "https://x.app",
    ].join("\n"));
  });
  it("handles singulars", () => {
    const text = batchSummary({ chat_id: 1, added: 0, needs_date: 0, existing: 1, not_poster: 1, failed: 1, uploaded: 0 }, "https://x.app");
    expect(text).toContain("🔁 1 was already saved");
    expect(text).toContain("🚫 1 wasn't an event poster");
    expect(text).toContain("⚠️ 1 couldn't be read, send it again later");
    expect(text).not.toContain("added");
  });
});

describe("app uploads (auto-import)", async () => {
  const { processPoster, batchSummary } = await import("./bot");
  const upload = {
    chat_id: ME, message_id: 0, file_id: null, thumb_file_id: null, file_unique_id: null, caption: null,
    source: "upload" as const, image_b64: Buffer.from([0xff, 0xd8, 0xff]).toString("base64"), mime: "image/jpeg",
  };

  it("stores a poster on Telegram and saves it without replying", async () => {
    extraction = event();
    expect(await processPoster(upload)).toBe("added");
    expect(stored).toHaveLength(1);
    expect(rows[0]).toMatchObject({ file_id: "stored-file", thumb_file_id: "stored-thumb", bot_msg_id: null });
    expect(sent).toHaveLength(0);
  });

  it("discards non-posters without storing them", async () => {
    extraction = event({ is_event: false });
    expect(await processPoster(upload)).toBe("not_poster");
    expect(stored).toHaveLength(0);
    expect(rows).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("labels an auto-import summary", () => {
    const text = batchSummary({ chat_id: 1, added: 3, needs_date: 1, existing: 0, not_poster: 10, failed: 1, uploaded: 15 }, "https://x.app");
    expect(text).toContain("<b>Auto-import</b> 15 new images checked:");
    expect(text).toContain("✅ 4 added (1 needs a date: set it in the app or on the website)");
    expect(text).toContain("⚠️ 1 couldn't be read, will retry next import");
  });
});
