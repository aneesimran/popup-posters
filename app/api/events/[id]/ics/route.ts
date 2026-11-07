import { getEvent } from "@/lib/db";
import { toIcs } from "@/lib/ics";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(Number(id));
  if (!event?.start_date) return new Response("Not found", { status: 404 });
  const slug = event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
  return new Response(toIcs(event, new URL(req.url).host), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}.ics"`,
    },
  });
}
