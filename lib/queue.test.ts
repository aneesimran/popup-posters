import { describe, expect, it } from "vitest";
import { isRateLimit, retryDelaySeconds } from "./queue";

describe("queue retry rules", () => {
  it("recognises Gemini rate limits, overload and timeouts", () => {
    expect(isRateLimit(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(true);
    expect(isRateLimit(new Error("503 This model is currently experiencing high demand"))).toBe(true);
    expect(isRateLimit(new Error("AbortError: This operation was aborted"))).toBe(true);
    expect(isRateLimit(new Error("Telegram getFile failed: Bad Request"))).toBe(false);
  });
  it("backs off a minute more each time for rate limits, 30s steps otherwise", () => {
    const limit = new Error("429");
    expect([0, 1, 2].map((a) => retryDelaySeconds(limit, a))).toEqual([60, 120, 180]);
    expect(retryDelaySeconds(limit, 50)).toBe(600);
    expect(retryDelaySeconds(new Error("boom"), 1)).toBe(60);
  });
});
