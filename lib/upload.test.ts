import { describe, expect, it } from "vitest";
import { sha256Hex, sniffImageType } from "./upload";
import { matchesSearch } from "./listing";
import type { EventRow } from "./types";

describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP by their bytes", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(sniffImageType(webp)).toBe("image/webp");
  });
  it("rejects anything else", () => {
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("sha256Hex", () => {
  it("fingerprints identical bytes identically", async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    expect(a).toBe(await sha256Hex(new Uint8Array([1, 2, 3])));
    expect(a).not.toBe(await sha256Hex(new Uint8Array([1, 2, 4])));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("matchesSearch", () => {
  const e = {
    title: "Winter Night Market", venue: "Ilford Town Hall", area: "Ilford", region: "London",
    description: "Food stalls and crafts", postcode: "IG1 1DD",
  } as EventRow;
  it("needs every word to appear somewhere, ignoring case", () => {
    expect(matchesSearch(e, "winter ilford")).toBe(true);
    expect(matchesSearch(e, "CRAFTS london")).toBe(true);
    expect(matchesSearch(e, "winter birmingham")).toBe(false);
  });
  it("matches everything for an empty search", () => {
    expect(matchesSearch(e, "  ")).toBe(true);
  });
});
