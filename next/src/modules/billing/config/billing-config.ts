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
 * Values for later phases (heartbeats, batch sizes, `expire_by`, operation
 * lease, trial length, `total_count`) are added by the phase that uses them.
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
