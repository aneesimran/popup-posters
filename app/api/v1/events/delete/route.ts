import { hasApiKey } from "@/lib/auth";
import { json } from "@/lib/api";
import { deleteEvents } from "@/lib/db";

/** Delete posters from the Android app: `{"ids": [1, 2, 3]}` → `{"deleted": 3}`. */
export async function POST(req: Request) {
  if (!hasApiKey(req)) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
  if (!ids.length || ids.length > 500) return json({ error: "send ids: a list of 1 to 500 event ids" }, 400);
  return json({ deleted: await deleteEvents(ids) });
}
