/**
 * Billing — Configuration
 *
 * The only place a tuning number for the provider boundary appears. Domain
 * code imports a named constant; it never sees a literal and never reads
 * `process.env` itself. Mirrors
 * `modules/notifications/config/notification-config.ts` in shape and in the
 * habit of recording *why* a number is what it is.
 *
 * These are deployment tuning, not product rules: every value has a
 * considered default and an environment override. They are the
 * IMPLEMENTATION-TIME values C1 (request budget) and C2 (backoff and
 * cooldown) from docs/architecture/subscription/implementation/open-decisions.md,
 * plus the client timeout. The defaults are deliberately conservative because
 * **Razorpay publishes no rate-limit numbers** (A12): the only source is
 * Razorpay Support, and that answer is a LIVE blocker resolved in Phase IX.
 * Until then, bounding Kizunia's own traffic well below any plausible limit is
 * the safe reading under any scope.
 *
 * Phase IV adds C3 (heartbeats and checkpoint margins), C4 (batch sizes), C7
 * (the trial-conversion grace) and the alert thresholds. Phase V adds C5 (the
 * checkout `expire_by` horizon and the operation lease), `total_count`, the
 * outcome-unknown window and orphan discovery. Trial length arrives with
 * Phase VII.
 *
 * Provider *credentials* are not tuning and are not read here: they are read
 * once, at boot, by `provider/provider-mode.ts`.
 */

/**
 * Reads a positive integer from the environment, falling back to `fallback`.
 *
 * Deliberately forgiving: a malformed value falls back rather than throwing.
 * These are tuning knobs, and a typo in one should degrade the cadence, not
 * prevent the application from starting. (Credentials are the opposite: a
 * typo there is a configuration error and fails at boot.)
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** As `envInt`, but zero is a legitimate value (for example "no headroom"). */
function envNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// The outbound request budget (C1)
// ---------------------------------------------------------------------------

/**
 * One budget per provider mode, shared by every instance and every caller.
 * Every outbound call acquires one unit first, at its caller's priority
 * (docs/architecture/subscription/reconciliation/provider-rate-limits.md).
 *
 * Priorities share one counter and differ only by ceiling:
 *
 *   P1 commands, admin "sync now"   the whole `limit`
 *   P2 checkout confirm, webhooks   `limit` − `headroomForPriority1`
 *   P3 due reconciliation           P2 ceiling − `headroomForPriority2`
 *   P4 orphan discovery             `orphanCeiling`, only while the window is quiet
 *
 * so a background backlog can never crowd out a customer who is waiting.
 */
export const BUDGET_CONFIG = {
  /**
   * The fixed window the counter is keyed on, in seconds.
   *
   * A minute is short enough that a burst is bounded quickly and a refused
   * caller only waits briefly, and long enough that the counter row is not
   * churned on every request.
   */
  windowSeconds: envInt("BILLING_BUDGET_WINDOW_SECONDS", 60),

  /**
   * Provider calls allowed per window: 60 a minute, one a second on average.
   *
   * Sized to be well under any plausible account limit, and far above steady
   * state. Due-based scheduling makes demand proportional to lifecycle events,
   * not to subscriptions: 5,000 paying customers on monthly cycles is a few
   * hundred fetches a day. The budget exists to cap *bursts* (an incident
   * backlog, a Dashboard bulk action, a webhook storm), not steady state.
   */
  limit: envInt("BILLING_BUDGET_LIMIT", 60),

  /** Units of the window reserved for priority 1 against priorities 2–4. */
  headroomForPriority1: envNonNegativeInt("BILLING_BUDGET_HEADROOM_P1", 15),

  /** Further units reserved for priority 2 against priorities 3–4. */
  headroomForPriority2: envNonNegativeInt("BILLING_BUDGET_HEADROOM_P2", 15),

  /**
   * Priority 4's ceiling on the shared counter. Because it is a low absolute
   * number, orphan discovery is only admitted while the window is otherwise
   * quiet, which is the design's "only when priority 3 has no due work".
   */
  orphanCeiling: envInt("BILLING_BUDGET_ORPHAN_CEILING", 10),
} as const;

// ---------------------------------------------------------------------------
// Backoff and the global cooldown (C2)
// ---------------------------------------------------------------------------

/**
 * Per-subscription retry delay: `min(cap, base · 2^attempts)`, multiplied by a
 * random factor in [0.5, 1.0] so a shared outage does not re-synchronize every
 * retry. A subscription is never marked permanently failed: past the cap it is
 * retried at the capped interval indefinitely. Used by synchronization
 * (Phase IV); the math lives here so the cooldown and the retries agree.
 */
export const BACKOFF_CONFIG = {
  /** The first retry delay. */
  baseSeconds: envInt("BILLING_BACKOFF_BASE_SECONDS", 60),

  /**
   * The longest retry delay: six hours. A subscription whose provider read
   * keeps failing is still looked at four times a day, and never given up on.
   */
  capSeconds: envInt("BILLING_BACKOFF_CAP_SECONDS", 6 * 60 * 60),
} as const;

/**
 * The global cooldown: one shared marker per mode. While it is set,
 * priorities 2–4 do not call the provider at all; priority 1 still may, since
 * a customer explicitly asking to cancel should get a real answer if the
 * provider has recovered. Without it, per-subscription backoff alone still
 * sends one request per due subscription into an outage every tick.
 */
export const COOLDOWN_CONFIG = {
  /** The first cooldown: `base · 2^level`, jittered, capped. */
  baseSeconds: envInt("BILLING_COOLDOWN_BASE_SECONDS", 30),

  /** Fifteen minutes: long enough to relieve a rate limit, short enough to recover promptly. */
  capSeconds: envInt("BILLING_COOLDOWN_CAP_SECONDS", 15 * 60),

  /**
   * Consecutive timeouts or 5xx responses, across all callers, that enter a
   * cooldown as a 429 does. One transient failure must not stop billing; five
   * in a row with no success between them is an outage.
   */
  consecutiveFailureThreshold: envInt("BILLING_COOLDOWN_FAILURE_THRESHOLD", 5),
} as const;

// ---------------------------------------------------------------------------
// The Razorpay client
// ---------------------------------------------------------------------------

export const PROVIDER_CLIENT_CONFIG = {
  /**
   * How long one provider request may take before it is abandoned as a
   * `TIMEOUT`. Razorpay documents no client timeout guidance. Ten seconds is
   * generous for a single API call and still leaves a user-facing command
   * (which may make a few calls) well inside a 60-second function limit.
   *
   * A timed-out mutation is an *unknown* outcome, never a failure: the request
   * may have been processed. It is resolved by synchronization, not retried.
   */
  requestTimeoutMs: envInt("BILLING_PROVIDER_TIMEOUT_MS", 10_000),
} as const;

// ---------------------------------------------------------------------------
// When a subscription is next observed (C3, C7)
// ---------------------------------------------------------------------------

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

/**
 * Inputs to `policy/next-due.ts`: how soon after a lifecycle checkpoint a
 * subscription is observed, and how often it is observed when nothing is
 * scheduled (docs/architecture/subscription/reconciliation/reconciliation-job.md).
 *
 * A heartbeat is an upper bound on staleness when a webhook is missed and no
 * checkpoint is near. Webhooks are the primary path, so the heartbeats only
 * need to be short where a missed change would hurt most (an unfinished
 * checkout, a failing payment).
 */
export const SYNC_SCHEDULE_CONFIG = {
  /**
   * How long after a renewal, cycle end, trial start or scheduled change the
   * observation is made. Razorpay's renewal and its webhook take time; two
   * hours finds the settled state rather than racing it, and is still far
   * inside a day for a missed cancellation or failed charge.
   */
  checkpointMarginSeconds: envInt("BILLING_CHECKPOINT_MARGIN_SECONDS", 2 * HOUR_SECONDS),

  /**
   * How long after `expire_by` an unfinished checkout is observed. TEST saw
   * the move to `expired` 188 s and 322 s late (D6), so ten minutes clears
   * the observed lag with room to spare.
   */
  expireByMarginSeconds: envInt("BILLING_EXPIRE_BY_MARGIN_SECONDS", 10 * 60),

  /**
   * C7 (IB-9): how long a TRIAL may stay `authenticated` after `start_at` and
   * keep contributing while Razorpay runs the first charge. Four days covers
   * the charge day plus the documented card/UPI retries (T+1, T+2, T+3).
   */
  trialConversionGraceSeconds: envInt("BILLING_TRIAL_CONVERSION_GRACE_SECONDS", 4 * DAY_SECONDS),

  heartbeats: {
    /** An unfinished checkout either completes or expires quickly. */
    pendingAuthenticationSeconds: envInt("BILLING_HEARTBEAT_PENDING_AUTH_SECONDS", 6 * HOUR_SECONDS),
    trialingSeconds: envInt("BILLING_HEARTBEAT_TRIALING_SECONDS", 2 * DAY_SECONDS),
    /** Renewals and cycle ends are checkpoints; this only bounds a missed mid-cycle Dashboard change. */
    activeSeconds: envInt("BILLING_HEARTBEAT_ACTIVE_SECONDS", 7 * DAY_SECONDS),
    /** Retries are daily for cards and UPI. */
    pastDueSeconds: envInt("BILLING_HEARTBEAT_PAST_DUE_SECONDS", DAY_SECONDS),
    pausedSeconds: envInt("BILLING_HEARTBEAT_PAUSED_SECONDS", 7 * DAY_SECONDS),
    /** SB-PF-05: a halted subscription is observed less often the longer it stays halted, and is never dropped. */
    haltedFirstWeekSeconds: envInt("BILLING_HEARTBEAT_HALTED_SECONDS", DAY_SECONDS),
    haltedFirstMonthSeconds: envInt("BILLING_HEARTBEAT_HALTED_AFTER_WEEK_SECONDS", 7 * DAY_SECONDS),
    haltedAfterMonthSeconds: envInt("BILLING_HEARTBEAT_HALTED_AFTER_MONTH_SECONDS", 30 * DAY_SECONDS),
  },
} as const;

// ---------------------------------------------------------------------------
// Sync batches, leases and the tick budget (C4, IB-10)
// ---------------------------------------------------------------------------

export const SYNC_CONFIG = {
  /**
   * Rows claimed per batch by the `billing:sync` drain. Fetches in a batch run
   * one after another, so a small batch keeps the lease short and lets the
   * drain stop close to its deadline.
   */
  batchSize: envInt("BILLING_SYNC_BATCH_SIZE", 5),

  /**
   * How long a claim holds a row. It must outlast the rest of the batch: at
   * most the drain's deadline plus one provider timeout (10 s + 10 s). A lease
   * that lapses (a crashed worker) makes the row claimable again.
   */
  leaseSeconds: envInt("BILLING_SYNC_LEASE_SECONDS", 60),

  /**
   * IB-10: the `billing:sync` task's soft wall-clock budget inside the tick,
   * which has `maxDuration` 60 s and runs its tasks one after another. The
   * drain starts no new fetch after it, so the worst case is this plus one
   * provider timeout. The notification drain's default was lowered to 30 s so
   * the two, the three-day tasks and teardown fit.
   */
  wallClockMs: envInt("BILLING_SYNC_WALL_CLOCK_MS", 10_000),

  /**
   * How many subscriptions one webhook's `after()` syncs at most. An event
   * names one subscription; the cap bounds a pathological payload, and the
   * tick drains anything left.
   */
  afterSyncCap: envInt("BILLING_WEBHOOK_AFTER_SYNC_CAP", 3),

  /** Unmatched webhook events resolved per `billing:sync` run (IB-24 item 4). */
  unmatchedBatchSize: envInt("BILLING_UNMATCHED_BATCH_SIZE", 10),

  /**
   * An unmatched event younger than this is left to the `after()` of the
   * request that recorded it, so the tick does not race it.
   */
  unmatchedGraceSeconds: envInt("BILLING_UNMATCHED_GRACE_SECONDS", 120),
} as const;

// ---------------------------------------------------------------------------
// Commands (C5, Phase V)
// ---------------------------------------------------------------------------

export const COMMAND_CONFIG = {
  /**
   * C5: how long an `IN_FLIGHT` operation holds the user's slot before it is
   * presumed dead and becomes `OUTCOME_UNKNOWN`. It must outlast the whole
   * command — the budget check, one provider timeout (10 s) and the settle
   * transaction — with a wide margin, because a lease that lapses under a live
   * command turns a clean result into an unknown one. It is also the send-time
   * upper bound orphan discovery uses after a crash (IB-25 item 2).
   */
  operationLeaseSeconds: envInt("BILLING_OPERATION_LEASE_SECONDS", 60),

  /**
   * While an `OUTCOME_UNKNOWN` operation younger than this exists, the user's
   * new commands are refused with "still being confirmed". Long enough for a
   * webhook, the next sync or an orphan scan to resolve it; after it a stale
   * unknown no longer blocks the user (an unknown create still does, through
   * its `PROVISIONING` row, until it is bound or closed).
   */
  outcomeUnknownResolutionSeconds: envInt("BILLING_OUTCOME_UNKNOWN_WINDOW_SECONDS", 30 * 60),
} as const;

// ---------------------------------------------------------------------------
// Checkout (C5, A13, Phase V)
// ---------------------------------------------------------------------------

export const CHECKOUT_CONFIG = {
  /**
   * C5: how long the customer has to authenticate (`expire_by`). Thirty
   * minutes covers a card's 3-D Secure or a mandate registration with room to
   * spare, and keeps an abandoned checkout from lingering. Razorpay moves a
   * `created` subscription to `expired` minutes late (D6: 188 s and 322 s),
   * which the reuse margin and the orphan overlap absorb.
   */
  expireBySeconds: envInt("BILLING_CHECKOUT_EXPIRE_BY_SECONDS", 30 * 60),

  /**
   * A pending checkout for the same plan and cycle is handed back only if at
   * least this long remains before its `expire_by`; otherwise it is treated as
   * expired (abandoned, then recreated), so a user is never given a checkout
   * that expires mid-payment (IB-25 item 5).
   */
  reuseMinRemainingSeconds: envInt("BILLING_CHECKOUT_REUSE_MIN_REMAINING_SECONDS", 5 * 60),

  /**
   * `total_count` per cycle: the TEST-observed ceilings (A13: monthly ×1 →
   * 1200, yearly ×1 → 100), roughly a hundred years of billing, so a
   * subscription effectively never reaches `completed`. Razorpay requires one.
   */
  totalCount: {
    MONTHLY: envInt("BILLING_TOTAL_COUNT_MONTHLY", 1200),
    YEARLY: envInt("BILLING_TOTAL_COUNT_YEARLY", 100),
  },
} as const;

// ---------------------------------------------------------------------------
// Orphan discovery (Phase V)
// ---------------------------------------------------------------------------

export const ORPHAN_CONFIG = {
  /**
   * How far each window reaches back before the watermark. The list filter is
   * inclusive on `created_at` (A5), so the overlap only covers clock skew and a
   * slow create; it is also the margin after which an unmatched unknown create
   * is declared `ABANDONED`. Fifteen minutes is well past the ~6 minutes of
   * provider lag D6 observed: closing too early is how a duplicate could be
   * created, closing late only delays a retry.
   */
  overlapSeconds: envInt("BILLING_ORPHAN_OVERLAP_SECONDS", 15 * 60),

  /** The newest minutes are not scanned, so an in-progress create is not misreported. */
  settleDelaySeconds: envInt("BILLING_ORPHAN_SETTLE_DELAY_SECONDS", 5 * 60),

  /** Items per list request: Razorpay's maximum. */
  pageSize: envInt("BILLING_ORPHAN_PAGE_SIZE", 100),

  /** Pages per run; a backlog drains over several runs without skipping anything. */
  maxPagesPerRun: envInt("BILLING_ORPHAN_MAX_PAGES_PER_RUN", 3),

  /** The task's soft wall-clock budget: no new page starts after it. */
  wallClockMs: envInt("BILLING_ORPHAN_WALL_CLOCK_MS", 5_000),

  /** The tick runs it at most this often (reconciliation.md: ~900 s). */
  minIntervalSeconds: envInt("BILLING_ORPHAN_MIN_INTERVAL_SECONDS", 15 * 60),
} as const;

// ---------------------------------------------------------------------------
// Alert thresholds (IB-11: log-only until Phase IX chooses the channel)
// ---------------------------------------------------------------------------

export const ALERT_CONFIG = {
  /**
   * Consecutive failed syncs of one subscription that raise `SYNC_OVERDUE`
   * (and again at every multiple). With the default backoff that is a little
   * over two hours of failures.
   */
  syncOverdueAttempts: envInt("BILLING_SYNC_OVERDUE_ATTEMPTS", 6),

  /**
   * The oldest due subscription waiting longer than this raises `SYNC_OVERDUE`
   * from the tick. Two days tolerates the daily Hobby cron in TEST (IB-19).
   */
  syncOverdueSeconds: envInt("BILLING_SYNC_OVERDUE_SECONDS", 2 * DAY_SECONDS),

  /**
   * No webhook in this mode for this long, while synced open subscriptions
   * exist, raises `WEBHOOK_SILENCE`. Monthly renewals make days of silence
   * normal for a small base; tune once LIVE volume is known (Phase IX).
   */
  webhookSilenceSeconds: envInt("BILLING_WEBHOOK_SILENCE_SECONDS", 7 * DAY_SECONDS),

  /** A webhook response slower than this raises `WEBHOOK_LATENCY`: Razorpay's limit is 5 s. */
  webhookLatencyAlertMs: envInt("BILLING_WEBHOOK_LATENCY_ALERT_MS", 3_000),

  /** Rejected webhook signatures per mode per hour above which `WEBHOOK_SIGNATURE_FAILURES` is raised. */
  signatureFailuresPerHour: envInt("BILLING_WEBHOOK_SIGNATURE_FAILURES_PER_HOUR", 20),

  /**
   * An operation still `OUTCOME_UNKNOWN` (or a lapsed `IN_FLIGHT`) after this
   * long raises `OPERATION_OUTCOME_UNKNOWN`: a user may have been charged
   * without a record, or is blocked. Two days, like `syncOverdueSeconds`,
   * tolerates the daily Hobby cron in TEST (IB-19); tune for LIVE in Phase IX.
   */
  operationOutcomeUnknownSeconds: envInt("BILLING_OPERATION_OUTCOME_UNKNOWN_ALERT_SECONDS", 2 * DAY_SECONDS),
} as const;
