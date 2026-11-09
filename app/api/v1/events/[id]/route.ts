import { hasApiKey } from "@/lib/auth";
import { json, toApiEvent } from "@/lib/api";
import { getEvent } from "@/lib/db";
import { distanceFromHome, homePoint } from "@/lib/geo";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasApiKey(req)) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const e = Number.isInteger(Number(id)) ? await getEvent(Number(id)) : null;
  if (!e) return json({ error: "not found" }, 404);
  return json(toApiEvent({ e, miles: distanceFromHome(e, await homePoint()) }, new URL(req.url).origin));
}
