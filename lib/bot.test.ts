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
}));
vi.mock("./geo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./geo")>()),
  homePoint: async () => ({ lat: 51.5416, lng: -0.0033 }), // Stratford station
  locateEvent: async () => ({ lat: 51.5590, lng: 0.0741, source: "venue" }), // Ilford Town Hall
}));
vi.mock("./gemini", () => ({
  extractPoster: async () => extraction,
  parseDateReply: async () => dateReply,
}));

const { handleUpdate } = await import("./bot");

const ME = 42;
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
  end_time: null, venue: "Ilford Town Hall", area: "Ilford", price: "Free", description: null, postcode: null, ...over,
});
const last = () => sent[sent.length - 1].text;

beforeEach(() => {
  rows.length = 0;
  sent.length = 0;
  process.env.ALLOWED_CHAT_ID = String(ME);
});

describe("handleUpdate", () => {
  it("adds a poster and confirms it", async () => {
    extraction = event();
    await handleUpdate(photo("a"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", area: "Ilford", bot_msg_id: 1001, geo_source: "venue" });
    expect(last()).toContain("Added:");
    expect(last()).toMatch(/Ilford Town Hall · \d\.\d mi from home/);
    expect(last()).toContain("Sat 14 Nov, 6pm");
  });

  it("skips non-events", async () => {
    extraction = event({ is_event: false });
    await handleUpdate(photo("meme"));
    expect(rows).toHaveLength(0);
    expect(last()).toContain("Doesn't look like an event");
  });

  it("spots the same image and the same event in a different image", async () => {
    extraction = event();
    await handleUpdate(photo("a"));
    await handleUpdate(photo("a"));
    expect(last()).toContain("Already have this one");
    extraction = event({ title: "WINTER NIGHT MARKET!" });
    await handleUpdate(photo("b"));
    expect(last()).toContain("Already have this one");
    expect(rows).toHaveLength(1);
  });

  it("asks for a date, then fills it in from a reply", async () => {
    extraction = event({ start_date: null, start_time: null });
    await handleUpdate(photo("nodate"));
    expect(rows[0].status).toBe("pending");
    expect(last()).toContain("Reply to this message with the date");
    await handleUpdate(text("next sat 2pm", rows[0].bot_msg_id!));
    expect(rows[0]).toMatchObject({ status: "active", start_date: "2026-11-21", start_time: "14:00" });
    expect(last()).toContain("Updated:");
  });

  it("deletes an event when you reply /delete", async () => {
    extraction = event();
    await handleUpdate(photo("a"));
    await handleUpdate(text("/delete", rows[0].bot_msg_id!));
    expect(rows).toHaveLength(0);
    expect(last()).toContain("Deleted");
  });

  it("ignores other people, and tells the owner their chat ID during setup", async () => {
    extraction = event();
    const stranger = photo("x");
    stranger.message.chat.id = 7;
    await handleUpdate(stranger);
    expect(rows).toHaveLength(0);
    expect(sent).toHaveLength(0);

    delete process.env.ALLOWED_CHAT_ID;
    await handleUpdate(text("/start"));
    expect(last()).toContain(`<code>${ME}</code>`);
  });
});
