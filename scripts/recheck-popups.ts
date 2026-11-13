// Re-check saved posters against the "popup / stall event" rule.
//   npm run recheck-popups                 list the posters that would be removed (changes nothing)
//   npm run recheck-popups -- --delete 1,2 delete those ids (after you've reviewed the list)
// Reads each poster image directly (not via the queue), one every 7s to stay within Gemini's limit.
import { allEvents, deleteEvents } from "../lib/db";
import { checkStalls } from "../lib/gemini";
import { downloadFile } from "../lib/telegram";

const delArg = process.argv.indexOf("--delete");
if (delArg !== -1) {
  const ids = (process.argv[delArg + 1] ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw new Error("Usage: --delete 12,34,56");
  console.log(`Deleted ${await deleteEvents(ids)} of ${ids.length}.`);
  process.exit(0);
}

const events = await allEvents();
const remove: string[] = [];
let checked = 0;
for (const e of events) {
  const started = Date.now();
  try {
    const { bytes, mimeType } = await downloadFile(e.file_id);
    let result: { has_stalls: boolean; reason: string } | null = null;
    for (let attempt = 1; attempt <= 4 && !result; attempt++) {
      try {
        result = await checkStalls(bytes, mimeType);
      } catch {
        await new Promise((r) => setTimeout(r, 30_000 * attempt)); // Gemini busy: wait and retry
      }
    }
    checked++;
    if (!result) console.log(`#${e.id} ${e.title}: couldn't check`);
    else if (!result.has_stalls) {
      const line = `#${e.id}\t${e.start_date ?? "no date"}\t${e.title}\t(${result.reason})`;
      remove.push(line);
      console.log("NOT POPUP " + line);
    }
  } catch (err) {
    console.log(`#${e.id} ${e.title}: image error ${String(err).slice(0, 80)}`);
  }
  const wait = 7_000 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
console.log(`\nChecked ${checked} of ${events.length}. ${remove.length} would be removed:\n${remove.join("\n")}`);
const ids = remove.map((l) => l.split("\t")[0].slice(1)).join(",");
if (ids) console.log(`\nTo delete them all: npm run recheck-popups -- --delete ${ids}`);
