const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result;
}

export type TgPhotoSize = { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number };
export type TgDocument = { file_id: string; file_unique_id: string; mime_type?: string; file_name?: string; thumbnail?: TgPhotoSize };
export type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: TgDocument;
  reply_to_message?: TgMessage;
};
export type TgUpdate = { update_id: number; message?: TgMessage };

export function sendMessage(chatId: number, text: string, replyTo?: number) {
  return call<TgMessage>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  });
}

export function sendTyping(chatId: number) {
  return call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

/** Download a file Telegram holds for us. Returns the bytes and a best-guess mime type. */
export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const file = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram returned no file_path");
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
  const ext = file.file_path.split(".").pop()?.toLowerCase();
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
