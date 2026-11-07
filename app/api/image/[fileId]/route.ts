import { downloadFile } from "@/lib/telegram";

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  try {
    const { bytes, mimeType } = await downloadFile(fileId);
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": mimeType,
        // A Telegram file_id always points to the same image.
        "cache-control": "private, max-age=2592000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
