import { describe, expect, it } from "vitest";
import { formatMiles, milesBetween, normalizePostcode } from "./geo";
import { overlaps, whenRange } from "./filters";

describe("normalizePostcode", () => {
  it("formats full and outward postcodes", () => {
    expect(normalizePostcode("sw1a1aa")).toBe("SW1A 1AA");
    expect(normalizePostcode(" SE14  6TJ ")).toBe("SE14 6TJ");
    expect(normalizePostcode("e15")).toBe("E15");
  });
  it("rejects things that aren't postcodes", () => {
    expect(normalizePostcode("Ilford")).toBeNull();
    expect(normalizePostcode("12345")).toBeNull();
    expect(normalizePostcode(null)).toBeNull();
  });
});

describe("milesBetween", () => {
  it("measures straight-line miles", () => {
    // Stratford to New Cross is about 5 miles as the crow flies.
    const m = milesBetween({ lat: 51.5416, lng: -0.0033 }, { lat: 51.4737, lng: -0.0413 });
    expect(m).toBeGreaterThan(4.5);
    expect(m).toBeLessThan(5.5);
  });
  it("formats miles", () => {
    expect(formatMiles(0.04)).toBe("<0.1 mi");
    expect(formatMiles(2.34)).toBe("2.3 mi");
    expect(formatMiles(14.6)).toBe("15 mi");
  });
});

describe("whenRange", () => {
  it("finds the coming weekend from a weekday", () => {
    expect(whenRange("weekend", "2026-11-11")).toEqual(["2026-11-14", "2026-11-15"]); // Wed
  });
  it("uses the current weekend on Saturday and Sunday", () => {
    expect(whenRange("weekend", "2026-11-14")).toEqual(["2026-11-14", "2026-11-15"]);
    expect(whenRange("weekend", "2026-11-08")).toEqual(["2026-11-08", "2026-11-08"]); // Sun
  });
  it("covers the rest of the month and the next 7 days", () => {
    expect(whenRange("month", "2026-11-08")).toEqual(["2026-11-08", "2026-11-30"]);
    expect(whenRange("week", "2026-11-28")).toEqual(["2026-11-28", "2026-12-04"]);
  });
  it("includes multi-day events that overlap the range", () => {
    const range: [string, string] = ["2026-11-14", "2026-11-15"];
    expect(overlaps({ start_date: "2026-11-12", end_date: "2026-11-14" }, range)).toBe(true);
    expect(overlaps({ start_date: "2026-11-16", end_date: null }, range)).toBe(false);
    expect(overlaps({ start_date: null, end_date: null }, range)).toBe(false);
  });
});
