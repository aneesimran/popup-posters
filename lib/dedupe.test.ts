import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeTitle } from "./dedupe";

describe("normalizeTitle", () => {
  it("ignores case, punctuation, emoji and articles", () => {
    expect(normalizeTitle("✨ The Winter Night-Market! ✨")).toBe("winter night market");
    expect(normalizeTitle("winter night market")).toBe("winter night market");
  });
  it("treats & as and, and strips accents", () => {
    expect(normalizeTitle("Café & Crafts")).toBe("cafe and crafts");
  });
});

describe("dedupeKey", () => {
  it("matches the same event shared twice", () => {
    expect(dedupeKey("Eid Bazaar 2026", "2026-11-14")).toBe(dedupeKey("EID BAZAAR 2026!!", "2026-11-14"));
  });
  it("differs by date", () => {
    expect(dedupeKey("Eid Bazaar", "2026-11-14")).not.toBe(dedupeKey("Eid Bazaar", "2026-11-21"));
  });
  it("is null without a date or title", () => {
    expect(dedupeKey("Eid Bazaar", null)).toBeNull();
    expect(dedupeKey("!!!", "2026-11-14")).toBeNull();
  });
});
