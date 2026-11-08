import { neon } from "@neondatabase/serverless";

// Telegram delivers a batch of shared posters all at once, but Gemini's free tier allows
// ~10 requests a minute. Posters go into a table and a single worker reads them one at a time.

export type PosterJob = {
  id: number;
  chat_id: number;
  message_id: number;
  file_id: string;
  thumb_file_id: string | null;
  file_unique_id: string;
  caption: string | null;
  attempts: number;
};

/** Minimum gap between Gemini calls (Flash-Lite free tier: 10 a minute). */
export const SPACING_MS = 7_000;
/**
 * A worker run only *starts* new posters within this window, then hands over to a fresh
 * function call. One poster can take ~70s in the worst case (Telegram download, two Gemini
 * attempts, location lookups), so this leaves plenty of room under the routes' maxDuration (300s).
 */
export const WORKER_BUDGET_MS = 60_000;
/** Longest a single wait (spacing, rate-limit pause, waiting for a retry) may last. */
const MAX_WAIT_MS = 30_000;
const LEASE_SECONDS = 290; // just under maxDuration, so a killed worker's lease soon expires
/** Give up on a poster after this many failed attempts. */
export const MAX_ATTEMPTS = 6;

let client: ReturnType<typeof neon> | null = null;
const sql = () => (client ??= neon(process.env.DATABASE_URL!));

/** Returns false if this exact image is already waiting in the queue. */
export async function enqueue(job: Omit<PosterJob, "id" | "attempts">): Promise<boolean> {
  const rows = (await sql()`
    insert into poster_jobs (chat_id, message_id, file_id, thumb_file_id, file_unique_id, caption)
    values (${job.chat_id}, ${job.message_id}, ${job.file_id}, ${job.thumb_file_id}, ${job.file_unique_id}, ${job.caption})
    on conflict (file_unique_id) do nothing
    returning id`) as { id: number }[];
  return rows.length > 0;
}

export async function queueLength(): Promise<number> {
  const rows = (await sql()`select count(*)::int as n from poster_jobs`) as { n: number }[];
  return rows[0].n;
}

async function nextWakeSeconds(): Promise<number | null> {
  const rows = (await sql()`
    select extract(epoch from (min(next_attempt_at) - now()))::float as s from poster_jobs`) as { s: number | null }[];
  return rows[0].s;
}

/** Only one worker at a time. The lease expires on its own if a worker dies. */
async function acquireLease(): Promise<boolean> {
  const rows = (await sql()`
    update bot_state set worker_until = now() + make_interval(secs => ${LEASE_SECONDS})
    where id = 1 and (worker_until is null or worker_until < now())
    returning id`) as unknown[];
  return rows.length > 0;
}

async function releaseLease() {
  await sql()`update bot_state set worker_until = null where id = 1`;
}

async function nextJob(): Promise<PosterJob | null> {
  const rows = (await sql()`
    select * from poster_jobs where next_attempt_at <= now() order by next_attempt_at, id limit 1`) as PosterJob[];
  return rows[0] ?? null;
}

async function finish(id: number) {
  await sql()`delete from poster_jobs where id = ${id}`;
}

async function retryLater(id: number, delaySeconds: number) {
  await sql()`
    update poster_jobs set attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => ${delaySeconds})
    where id = ${id}`;
}

/** Atomically claim the right to send a "working through your batch" note (at most every 10 minutes). */
export async function claimBatchNotice(): Promise<boolean> {
  const rows = (await sql()`
    update bot_state set notice_at = now()
    where id = 1 and (notice_at is null or notice_at < now() - interval '10 minutes')
    returning id`) as unknown[];
  return rows.length > 0;
}

export type Outcome = "added" | "needs_date" | "existing" | "not_poster" | "failed";

export type BatchTotals = {
  chat_id: number | null;
  added: number;
  needs_date: number;
  existing: number;
  not_poster: number;
  failed: number;
};

/** Seconds of no new posters before a batch counts as finished. */
export const QUIET_SECONDS = 12;

/** Add one poster's result to the running batch totals. */
export async function recordOutcome(chatId: number, outcome: Outcome) {
  const one = (o: Outcome) => (o === outcome ? 1 : 0);
  await sql()`
    update bot_state set
      batch_chat_id = ${chatId},
      batch_added = batch_added + ${one("added")},
      batch_needs_date = batch_needs_date + ${one("needs_date")},
      batch_existing = batch_existing + ${one("existing")},
      batch_not_poster = batch_not_poster + ${one("not_poster")},
      batch_failed = batch_failed + ${one("failed")},
      last_activity_at = now()
    where id = 1`;
}

/** Note that posters are still arriving, so the summary waits. */
export async function touchActivity() {
  await sql()`update bot_state set last_activity_at = now() where id = 1`;
}

/**
 * If the batch has gone quiet, take its totals and reset them (atomically, so only one
 * caller gets them). Returns "wait" if posters arrived too recently, null if there's nothing to report.
 */
export async function takeBatchTotals(): Promise<BatchTotals | "wait" | null> {
  const rows = (await sql()`
    with old as (select * from bot_state where id = 1 for update)
    update bot_state b set batch_added = 0, batch_needs_date = 0, batch_existing = 0, batch_not_poster = 0, batch_failed = 0
    from old
    where b.id = 1
      and old.batch_added + old.batch_needs_date + old.batch_existing + old.batch_not_poster + old.batch_failed > 0
      and (old.last_activity_at is null or old.last_activity_at < now() - make_interval(secs => ${QUIET_SECONDS}))
    returning old.batch_chat_id as chat_id, old.batch_added as added, old.batch_needs_date as needs_date,
              old.batch_existing as existing, old.batch_not_poster as not_poster, old.batch_failed as failed`) as BatchTotals[];
  if (rows[0]) return rows[0];
  const pending = (await sql()`
    select batch_added + batch_needs_date + batch_existing + batch_not_poster + batch_failed as n from bot_state where id = 1`) as { n: number }[];
  return (pending[0]?.n ?? 0) > 0 ? "wait" : null;
}

/** Gemini said "too many requests" or "overloaded", or every model timed out. */
export function isRateLimit(err: unknown): boolean {
  return /429|quota|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded|high demand|aborted|AbortError/i.test(String(err));
}

/** Wait before the next attempt: rate limits back off 1, 2, 3… minutes; other errors 30s, 60s… */
export function retryDelaySeconds(err: unknown, attempts: number): number {
  return isRateLimit(err) ? 60 * Math.min(attempts + 1, 10) : 30 * (attempts + 1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Handlers = {
  process: (job: PosterJob) => Promise<void>;
  giveUp: (job: PosterJob, err: unknown) => Promise<void>;
  /** Start a fresh function call to carry on (Vercel stops each call after maxDuration). */
  handOver: () => Promise<void>;
  /** Called when the queue is empty. Return true when finished, false to check again shortly. */
  onIdle: () => Promise<boolean>;
};

/**
 * Read queued posters one at a time, spaced SPACING_MS apart, for up to WORKER_BUDGET_MS.
 * Safe to call from every webhook: only the call that gets the lease does any work.
 */
export async function runWorker(h: Handlers): Promise<void> {
  if (!(await acquireLease())) return;
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  let nextCallAt = 0; // earliest time the next Gemini call may start
  try {
    while (elapsed() < WORKER_BUDGET_MS) {
      const job = await nextJob();
      if (!job) {
        const wake = await nextWakeSeconds();
        if (wake == null) {
          // Queue empty: wait for the batch to go quiet, then let the caller sum it up.
          if (await h.onIdle()) break;
          await sleep(3000);
        } else {
          // Only retries left: wait for the next one (a fresh call takes over if it's a while yet).
          await sleep(Math.min(Math.max(wake * 1000, 1000), MAX_WAIT_MS));
        }
        continue;
      }

      const wait = Math.min(nextCallAt - Date.now(), MAX_WAIT_MS);
      if (wait > 0) {
        if (elapsed() + wait >= WORKER_BUDGET_MS) break; // hand over rather than start late
        await sleep(wait);
      }
      nextCallAt = Date.now() + SPACING_MS;

      try {
        await h.process(job);
        await finish(job.id);
      } catch (err) {
        console.warn(`poster job ${job.id} attempt ${job.attempts + 1} failed: ${String(err).slice(0, 200)}`);
        if (job.attempts + 1 >= MAX_ATTEMPTS) {
          await finish(job.id);
          await h.giveUp(job, err).catch(() => {});
        } else {
          await retryLater(job.id, retryDelaySeconds(err, job.attempts));
          // Hitting the limit means the next poster would too: pause before carrying on.
          if (isRateLimit(err)) nextCallAt = Date.now() + 25_000;
        }
      }
    }
  } finally {
    await releaseLease();
  }

  // Posters left, retries scheduled, or a summary still to send: hand over to a fresh call.
  if ((await queueLength()) > 0 || (await takeBatchTotalsPeek())) {
    await h.handOver().catch((err) => console.error("queue hand-over failed", err));
  }
}

async function takeBatchTotalsPeek(): Promise<boolean> {
  const rows = (await sql()`
    select batch_added + batch_needs_date + batch_existing + batch_not_poster + batch_failed as n from bot_state where id = 1`) as { n: number }[];
  return (rows[0]?.n ?? 0) > 0;
}
