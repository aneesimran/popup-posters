import { describe, expect, it } from "vitest";
import { normalizeDateReply, normalizeExtraction } from "./extract";

describe("normalizeExtraction", () => {
  it("keeps a clean Gemini response", () => {
    const x = normalizeExtraction({
      is_event: true, title: " Winter  Night Market ", start_date: "2026-11-14", end_date: null,
      start_time: "18:00", end_time: "22:00", venue: "Ilford Town Hall", area: "Ilford", price: "Free", description: "Food stalls.",
    });
    expect(x).toMatchObject({ is_event: true, title: "Winter Night Market", start_date: "2026-11-14", start_time: "18:00", area: "Ilford" });
  });

  it("drops invalid dates and times instead of trusting them", () => {
    const x = normalizeExtraction({ is_event: true, title: "Bazaar", start_date: "2026-02-30", start_time: "6pm", end_date: "14/11" });
    expect(x.start_date).toBeNull();
    expect(x.end_date).toBeNull();
    expect(x.start_time).toBeNull();
  });

  it("drops an end date that isn't after the start", () => {
    expect(normalizeExtraction({ is_event: true, title: "A", start_date: "2026-11-14", end_date: "2026-11-14" }).end_date).toBeNull();
    expect(normalizeExtraction({ is_event: true, title: "A", start_date: "2026-11-14", end_date: "2026-11-16" }).end_date).toBe("2026-11-16");
  });

  it("treats placeholder strings as missing", () => {
    expect(normalizeExtraction({ is_event: true, title: "A", venue: "N/A", price: "unknown" })).toMatchObject({ venue: null, price: null });
  });

  it("only skips stall-less events on an explicit no", () => {
    expect(normalizeExtraction({ is_event: true, title: "A", has_stalls: false }).has_stalls).toBe(false);
    expect(normalizeExtraction({ is_event: true, title: "A", has_stalls: true }).has_stalls).toBe(true);
    expect(normalizeExtraction({ is_event: true, title: "A" }).has_stalls).toBe(true);
  });

  it("is not an event without a title, or with garbage input", () => {
    expect(normalizeExtraction({ is_event: true, title: "" }).is_event).toBe(false);
    expect(normalizeExtraction(null).is_event).toBe(false);
    expect(normalizeExtraction("nope").is_event).toBe(false);
  });
});

describe("normalizeDateReply", () => {
  it("keeps valid fields and drops an end time without a start time", () => {
    expect(normalizeDateReply({ start_date: "2026-11-21", start_time: null, end_time: "17:00" })).toEqual({
      start_date: "2026-11-21", end_date: null, start_time: null, end_time: null,
    });
  });
});
