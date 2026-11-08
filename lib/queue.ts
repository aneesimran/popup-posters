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
/** How long one worker run keeps going before handing over to a fresh function call. */
export const WORKER_BUDGET_MS = 85_000;
const LEASE_SECONDS = 115; // a little under the route's maxDuration of 120s
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
};

/**
 * Read queued posters one at a time, spaced SPACING_MS apart, for up to WORKER_BUDGET_MS.
 * Safe to call from every webhook: only the call that gets the lease does any work.
 */
export async function runWorker(h: Handlers): Promise<void> {
  if (!(await acquireLease())) return;
  const started = Date.now();
  let lastCall = 0;
  try {
    while (Date.now() - started < WORKER_BUDGET_MS - SPACING_MS) {
      const job = await nextJob();
      if (!job) {
        // Nothing ready: stop if the queue is empty, otherwise wait for the next retry
        // (up to the end of this run's budget, after which we hand over).
        const wake = await nextWakeSeconds();
        if (wake == null) break;
        const remaining = WORKER_BUDGET_MS - SPACING_MS - (Date.now() - started);
        await sleep(Math.max(Math.min(wake * 1000, remaining), 1000));
        continue;
      }

      const gap = SPACING_MS - (Date.now() - lastCall);
      if (gap > 0) await sleep(gap);
      lastCall = Date.now();

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
          if (isRateLimit(err)) lastCall = Date.now() + 20_000;
        }
      }
    }
  } finally {
    await releaseLease();
  }

  // Posters left (or retries scheduled): hand over to a fresh call.
  if ((await queueLength()) > 0) {
    await h.handOver().catch((err) => console.error("queue hand-over failed", err));
  }
}
