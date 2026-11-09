import sharp from "sharp";

/** Widths the image route will produce. Cards use 480, the detail view 1080; no width = original. */
export const IMAGE_WIDTHS = [320, 480, 720, 1080] as const;

export function parseWidth(v: string | null): number | null {
  const n = Number(v);
  return (IMAGE_WIDTHS as readonly number[]).includes(n) ? n : null;
}

/** Shrink a poster to `width` px wide as WebP: about a quarter of the bytes, no visible difference on a phone. */
export async function resizeToWebp(bytes: Uint8Array, width: number): Promise<Uint8Array> {
  const out = await sharp(bytes)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 74, effort: 4 })
    .toBuffer();
  return new Uint8Array(out);
}
