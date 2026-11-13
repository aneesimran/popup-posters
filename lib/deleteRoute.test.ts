import { beforeEach, describe, expect, it, vi } from "vitest";

const deleted: number[][] = [];
vi.mock("./db", () => ({
  deleteEvents: async (ids: number[]) => {
    deleted.push(ids);
    return ids.length;
  },
}));

const { POST } = await import("../app/api/v1/events/delete/route");
const req = (body: unknown, key?: string) =>
  new Request("http://x/api/v1/events/delete", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  deleted.length = 0;
  process.env.APP_API_KEY = "test-key-0123456789abcdef";
});

describe("POST /api/v1/events/delete", () => {
  it("needs the app key", async () => {
    expect((await POST(req({ ids: [1] }))).status).toBe(401);
    expect((await POST(req({ ids: [1] }, "wrong-key-0123456789abcd"))).status).toBe(401);
    expect(deleted).toHaveLength(0);
  });
  it("deletes the given ids, ignoring anything that isn't an id", async () => {
    const res = await POST(req({ ids: [3, 5, "7", -1, 2.5] }, "test-key-0123456789abcdef"));
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(deleted).toEqual([[3, 5]]);
  });
  it("rejects an empty list", async () => {
    expect((await POST(req({ ids: [] }, "test-key-0123456789abcdef"))).status).toBe(400);
  });
});
