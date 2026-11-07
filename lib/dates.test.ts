import { describe, expect, it } from "vitest";
import { addDays, dayLabel, formatTime, isValidDate, todayLondon } from "./dates";
import { toIcs } from "./ics";
import type { EventRow } from "./types";

describe("dates", () => {
  it("uses London time for today", () => {
    // 23:30 UTC on 30 June is already 1 July in London (BST).
    expect(todayLondon(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
  it("labels days", () => {
    expect(dayLabel("2026-11-07", "2026-11-07")).toBe("Today");
    expect(dayLabel("2026-11-08", "2026-11-07")).toBe("Tomorrow");
    expect(dayLabel("2026-11-14", "2026-11-07")).toBe("Sat 14 Nov");
  });
  it("formats times", () => {
    expect(formatTime("18:00")).toBe("6pm");
    expect(formatTime("09:30")).toBe("9:30am");
    expect(formatTime("00:00")).toBe("12am");
  });
  it("validates real dates", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
  });
});

describe("toIcs", () => {
  const base = { id: 1, title: "Night Market, Ilford", venue: "Town Hall", area: "Ilford", description: null, price: "Free" } as EventRow;
  it("writes a timed event with a default 2h length", () => {
    const ics = toIcs({ ...base, start_date: "2026-11-14", start_time: "23:00", end_date: null, end_time: null }, "x");
    expect(ics).toContain("DTSTART;TZID=Europe/London:20261114T230000");
    expect(ics).toContain("DTEND;TZID=Europe/London:20261115T010000");
    expect(ics).toContain("SUMMARY:Night Market\\, Ilford");
  });
  it("writes an all-day multi-day event with an exclusive end", () => {
    const ics = toIcs({ ...base, start_date: "2026-11-14", end_date: "2026-11-15", start_time: null, end_time: null }, "x");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261114");
    expect(ics).toContain("DTEND;VALUE=DATE:20261116");
  });
});
