/** Lowercase, strip punctuation/emoji and filler words so near-identical titles match. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["the", "a", "an"].includes(w))
    .join(" ");
}

/** Same event = same normalised title on the same start date. */
export function dedupeKey(title: string, startDate: string | null): string | null {
  const t = normalizeTitle(title);
  if (!t || !startDate) return null;
  return `${t}|${startDate}`;
}
