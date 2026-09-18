/**
 * Notifications — Configuration
 *
 * The only place a tuning number for this subsystem appears. Domain code
 * imports a named constant; it never sees a literal and never reads
 * `process.env` itself.
 *
 * Two kinds of value live here, and the difference matters:
 *
 *  - **Product rules** — the deadline offset, the summary size. These are
 *    decisions with rulings behind them. They are constants, and changing one
 *    means amending a ruling.
 *  - **Deployment tuning** — cadence, batch sizes, attempt counts. These are
 *    genuinely environment-dependent: a deployment whose sweep runs every five
 *    minutes and one whose sweep runs daily do not want the same retry
 *    horizon. These read an environment override.
 *
 * Mirrors `modules/recommendations/config/recommendation-config.ts` in shape
 * and in the habit of recording *why* a number is what it is.
 */

/**
 * Reads a positive integer from the environment, falling back to `fallback`.
 *
 * Deliberately forgiving: a malformed value falls back rather than throwing.
 * These are tuning knobs, and a typo in one should degrade the sweep's cadence,
 * not prevent the application from starting.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export const SCHEDULE_CONFIG = {
  /**
   * The hour, in UTC, at which the daily evaluation is scheduled (ND-I-23).
   *
   * One global run, not per-user local midnight: Kizunia stores no user
   * timezone, and a notification a person is meant to act on is worth
   * delivering during their day rather than at midnight. 13:00 UTC is early
   * afternoon in Europe, morning in the Americas, evening in India — no hour
   * is good everywhere, and this one is bad nowhere.
   */
  dailyHourUtc: envInt("NOTIFICATION_DAILY_HOUR_UTC", 13),

  /**
   * How often the worker sweep is expected to run, in seconds.
   *
   * This is not what *causes* the sweep to run — the deployment's scheduler
   * does that. It is what the system *believes* about its own cadence, and two
   * things are derived from it: the deadline evaluation band
   * ([ND-I-19](../../../../docs/project/feature-specification/notification/decisions/intents.md))
   * and whether a given retry horizon is sane.
   *
   * It must match reality. A deployment that ticks daily but claims to tick
   * every five minutes will leave gaps in deadline coverage.
   *
   * Default is one day, which is the conservative assumption: it is what a
   * Vercel Hobby deployment gets, and over-estimating the interval produces a
   * wider band and harmless duplicates-suppressed-by-dedup, while
   * under-estimating produces deadlines nobody is ever told about.
   */
  sweepIntervalSeconds: envInt("NOTIFICATION_SWEEP_INTERVAL_SECONDS", DAY_SECONDS),

  /**
   * How many users the scheduler enqueues per page while fanning out.
   *
   * Bounded so one scheduling pass is itself resumable: at 2,000+ users the
   * scheduler is doing real work, and an execution that dies halfway must
   * leave behind jobs for the users it reached rather than nothing.
   */
  userPageSize: envInt("NOTIFICATION_USER_PAGE_SIZE", 200),
} as const;

// ---------------------------------------------------------------------------
// Intent timing and selection — product rules
// ---------------------------------------------------------------------------

export const INTENT_CONFIG = {
  /**
   * How far ahead of a registration deadline the reminder targets (ND-I-10).
   *
   * Explicitly temporary, and explicitly a product decision rather than an
   * architectural one. It is a named constant precisely so that "2 days" does
   * not spread into the scheduler, the window query and the copy as three
   * independent literals that later disagree.
   */
  registrationClosingOffsetSeconds: envInt(
    "NOTIFICATION_DEADLINE_OFFSET_SECONDS",
    2 * DAY_SECONDS,
  ),

  /**
   * The most competitions one deadline summary covers (ND-I-13).
   *
   * The count is bounded by three things — this ceiling, how many candidates
   * clear the relevance floor, and nothing else. The floor is never lowered to
   * fill the summary (ND-R-02).
   *
   * ND-P-13 wants this per-user eventually; ND-P-17 defers that deliberately.
   */
  registrationClosingMaxSubjects: 5,

  /**
   * How many ranked candidates the deadline evaluation asks the recommendation
   * engine for before intersecting with the deadline window.
   *
   * Much larger than the summary size on purpose: the engine ranks *all* open
   * competitions, and the ones closing in a two-day band are a small and
   * essentially arbitrary slice of that ranking. Asking for the top 5 would
   * almost always intersect to nothing.
   */
  registrationClosingRelevanceTopN: envInt(
    "NOTIFICATION_DEADLINE_RELEVANCE_TOP_N",
    200,
  ),
} as const;

// ---------------------------------------------------------------------------
// Admin operational notices — product rules and cadence
// ---------------------------------------------------------------------------

export const ADMIN_NOTICE_CONFIG = {
  /**
   * How long a submitted suggestion must sit before admins are told about it.
   *
   * The product target is "near-real-time, roughly 30-60 minutes, and
   * deliberately not instant". This constant is the *floor* of that range; the
   * ceiling is the trigger cadence (`SCHEDULE_CONFIG.sweepIntervalSeconds`),
   * because a notice cannot be sent by a sweep that has not run.
   *
   * The delay is not a throttle. It buys a grace window in which the ordinary
   * corrections happen on their own — a contributor withdrawing a
   * mis-submission, an admin who was already looking at the queue reviewing it,
   * a resubmission arriving moments after the first. The handler re-reads the
   * suggestion before generating anything, so work that resolved itself inside
   * the window produces no notification at all rather than a notification about
   * something already handled.
   */
  suggestionNoticeDelaySeconds: envInt(
    "NOTIFICATION_ADMIN_SUGGESTION_DELAY_SECONDS",
    30 * MINUTE_SECONDS,
  ),

  /**
   * How far back the discovery sweep looks for suggestions still awaiting
   * review.
   *
   * Two jobs, and only one of them is deduplication — the occurrence key
   * already makes re-notifying impossible, so this is not what prevents
   * duplicates.
   *
   * What it does do: bound the scan, and stop the first deployment of this
   * feature from notifying every admin about every suggestion that has been
   * sitting in the queue since before it existed. A backlog is a thing to look
   * at, not a thing to be paged about retroactively.
   *
   * A suggestion older than this that was never notified stays un-notified. It
   * is still in the review queue, which is where it belongs.
   */
  suggestionLookbackSeconds: envInt(
    "NOTIFICATION_ADMIN_SUGGESTION_LOOKBACK_SECONDS",
    7 * DAY_SECONDS,
  ),

  /**
   * Suggestions one discovery pass will enqueue notices for.
   *
   * A ceiling on the pass, not on the queue: the sweep pages through the window
   * and stops here, and the next tick continues from the start because anything
   * already enqueued collides on its dedupe key and costs nothing. Bounded
   * execution (NFR-13) without a cursor to persist.
   */
  suggestionDiscoveryLimit: envInt(
    "NOTIFICATION_ADMIN_SUGGESTION_DISCOVERY_LIMIT",
    500,
  ),
} as const;

// ---------------------------------------------------------------------------
// Work queue
// ---------------------------------------------------------------------------

export const JOB_CONFIG = {
  /**
   * How long a claim holds a job before another worker may take it.
   *
   * The rule: **at least twice the p99 duration of a single job.** Too short
   * and a slow-but-healthy worker has its job stolen and does the work twice;
   * too long and a crashed worker's job sits idle for the whole lease.
   *
   * Two minutes suits an evaluation job, whose expensive step is one
   * recommendation engine run over a bounded candidate set.
   */
  leaseSeconds: envInt("NOTIFICATION_JOB_LEASE_SECONDS", 2 * MINUTE_SECONDS),

  /**
   * Jobs claimed per batch.
   *
   * Sized so `claimBatchSize × p95(job)` fits comfortably inside the wall-clock
   * budget below. Claiming more than can be processed is actively harmful: the
   * surplus sits leased and unavailable to other workers until it expires.
   */
  claimBatchSize: envInt("NOTIFICATION_JOB_BATCH_SIZE", 25),

  /**
   * Total attempts, including the first.
   *
   * The realistic failure for an evaluation job is a transient database or
   * pool error; five attempts covers a multi-minute blip without an operator.
   * Beyond that the failure is structural and retrying is noise.
   *
   * **On a daily-cadence deployment, lower this.** A retry scheduled a minute
   * out is not actually attempted for a day, so five attempts is a five-day
   * horizon — far longer than a notification about a deadline stays useful.
   * Three is the sane value there.
   */
  maxAttempts: envInt("NOTIFICATION_JOB_MAX_ATTEMPTS", 5),

  /** First retry delay. Longer than any pool-exhaustion or cold-start window. */
  backoffBaseSeconds: envInt("NOTIFICATION_JOB_BACKOFF_BASE_SECONDS", MINUTE_SECONDS),

  /** 60s, 120s, 240s, 480s — roughly a 15-minute horizon over four retries. */
  backoffFactor: 2,

  /**
   * Backoff ceiling. An hour, so a job scheduled for the early afternoon is
   * either done or dead well inside the day it concerns.
   */
  backoffCapSeconds: envInt("NOTIFICATION_JOB_BACKOFF_CAP_SECONDS", HOUR_SECONDS),

  /**
   * Retry delays are multiplied by `1 + random() * jitterRatio`.
   *
   * Not optional at this scale. A scheduler pass enqueues one job per user; if
   * a shared dependency fails, every one of those jobs fails at once and — with
   * no jitter — retries at exactly the same instant, reproducing the overload
   * that caused the failure. Jitter is what turns a thundering herd back into
   * a queue.
   */
  jitterRatio: 0.5,

  /**
   * How long one drain pass may spend claiming and processing before it stops
   * and reports that work remains.
   *
   * Must leave headroom under the platform's function timeout for one more job
   * plus teardown. 45s suits a 60s limit; raise it alongside `maxDuration` on a
   * platform that allows longer executions.
   */
  wallClockBudgetMs: envInt("NOTIFICATION_WORKER_BUDGET_MS", 45_000),

  /**
   * Whether a drain pass that still has work re-invokes the drain endpoint over
   * the network before returning.
   *
   * Off by default. It is genuinely useful on a platform that allows only a
   * daily trigger — without it, a backlog drains one batch per day — but it
   * re-enters the application over HTTP, needs the shared secret in-process,
   * and must carry its chain depth in the request rather than in memory.
   * Duplicate chains are harmless (claiming is concurrency-safe), but an
   * unbounded one is not.
   */
  selfContinue: envFlag("NOTIFICATION_WORKER_SELF_CONTINUE", false),

  /** Hard ceiling on self-continuation, whatever the caller claims. */
  selfContinueMaxDepth: envInt("NOTIFICATION_WORKER_MAX_CHAIN_DEPTH", 5),
} as const;

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export const DELIVERY_CONFIG = {
  /**
   * Total push attempts, including the first.
   *
   * FCM's own transient conditions — `UNAVAILABLE`, `INTERNAL`, 429 — clear in
   * seconds to low minutes. Four attempts over roughly twenty minutes covers
   * them; a failure that survives that is not transient.
   */
  pushMaxAttempts: envInt("NOTIFICATION_PUSH_MAX_ATTEMPTS", 4),

  /**
   * First retry delay for a push.
   *
   * FCM's guidance is a minimum of a minute between retries on `UNAVAILABLE`.
   * With jitter applied, 30s lands the first retry at 30–45s and the second
   * comfortably past a minute.
   */
  pushBackoffBaseSeconds: envInt("NOTIFICATION_PUSH_BACKOFF_BASE_SECONDS", 30),

  /** 30s, 90s, 270s, 810s — roughly a 20-minute horizon. */
  pushBackoffFactor: 3,

  pushBackoffCapSeconds: envInt("NOTIFICATION_PUSH_BACKOFF_CAP_SECONDS", 30 * MINUTE_SECONDS),

  pushJitterRatio: 0.5,

  /**
   * How long a push stays worth sending after its notification was created.
   *
   * Past this the delivery is `SKIPPED` with reason `STALE`, not `FAILED`
   * (ND-D-13) — it was a deliberate decision, not an error, and a failure
   * metric full of deliberate decisions stops being readable.
   *
   * Six hours: a push about a deadline two days out has no value delivered
   * late, and the inbox already carries the information.
   */
  pushValidForSeconds: envInt("NOTIFICATION_PUSH_VALID_FOR_SECONDS", 6 * HOUR_SECONDS),

  /**
   * Consecutive retryable failures on one subscription before it is deactivated
   * defensively (ND-D-09).
   *
   * A token can be dead in a way the provider never reports cleanly. Five
   * failures with no success in between is enough evidence to stop spending
   * quota on it; the browser re-registers on its next visit anyway.
   */
  consecutiveFailureCeiling: envInt("NOTIFICATION_PUSH_FAILURE_CEILING", 5),

  /**
   * Push subscriptions fanned out to per delivery job.
   *
   * A user with an implausible number of registered browsers should not turn
   * one notification into an unbounded batch of provider calls.
   */
  maxSubscriptionsPerUser: envInt("NOTIFICATION_PUSH_MAX_SUBSCRIPTIONS", 20),
} as const;

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export const RETENTION_CONFIG = {
  /**
   * How long a finished job row is kept.
   *
   * Completed jobs carry no product meaning — the notification they produced is
   * the record that matters — so they are prunable without consequence. They
   * are kept a week so that "why did nothing arrive on Tuesday?" is still
   * answerable on Friday.
   */
  completedJobSeconds: envInt("NOTIFICATION_JOB_RETENTION_SECONDS", 7 * DAY_SECONDS),

  /**
   * How long per-attempt delivery audit rows are kept.
   *
   * This table grows fastest — several rows per notification per device — and
   * is purely diagnostic.
   *
   * **Nothing that participates in deduplication is pruned at all.** Deleting a
   * delivered notification would make its subject eligible for discovery again
   * and re-notify the user about something they were already told. That
   * interaction is open decision A-11 and is deliberately not acted on here.
   */
  deliveryAttemptSeconds: envInt("NOTIFICATION_ATTEMPT_RETENTION_SECONDS", 30 * DAY_SECONDS),

  /** Rows deleted per prune pass, so pruning never becomes the long-running job. */
  pruneBatchSize: envInt("NOTIFICATION_PRUNE_BATCH_SIZE", 500),
} as const;
