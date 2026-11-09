/** Recognise JPEG, PNG and WebP from their first bytes (don't trust the client's content type). */
export function sniffImageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export async function sha256Hex(b: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", b as BufferSource);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Vercel caps request bodies at 4.5 MB; WhatsApp images are well under that. */
export const MAX_UPLOAD_BYTES = 4_400_000;
