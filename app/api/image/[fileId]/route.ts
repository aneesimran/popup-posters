import { downloadFile } from "@/lib/telegram";
import { parseWidth, resizeToWebp } from "@/lib/imageResize";

/**
 * A poster image from Telegram. `?w=480` (or 320/720/1080) returns a smaller WebP copy,
 * used by the website cards and the Android app to save data and load faster.
 */
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const width = parseWidth(new URL(req.url).searchParams.get("w"));
  try {
    const { bytes, mimeType } = await downloadFile(fileId);
    let body: Uint8Array = bytes;
    let type = mimeType;
    if (width) {
      body = await resizeToWebp(bytes, width).catch(() => bytes);
      if (body !== bytes) type = "image/webp";
    }
    return new Response(body as BodyInit, {
      headers: {
        "content-type": type,
        // A Telegram file_id always points to the same image.
        "cache-control": "private, max-age=2592000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
