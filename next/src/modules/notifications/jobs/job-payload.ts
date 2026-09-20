/**
 * Notifications — Job Payloads
 *
 * A job payload crosses a raw-SQL boundary. `$queryRaw` returns
 * `Prisma.JsonValue`, so the generated client's type safety stops at the edge
 * of the queue and everything past it would be an unchecked cast. These schemas
 * put the safety back: the runner parses a payload before a handler ever sees
 * it, and a handler receives a typed value or the job fails cleanly.
 *
 * ## Why every payload carries its own frozen time
 *
 * Nothing here is derived from the worker's clock (ND-D-07). The scheduler
 * computes the occurrence key and any evaluation window once, and the payload
 * carries them. A job retried across a UTC midnight must reproduce the *same*
 * decision, not a fresh one — otherwise it computes a different occurrence key
 * and generates a second notification for the same occasion.
 *
 * Timestamps are ISO strings rather than Dates because that is what JSON
 * actually holds. Converting at the boundary is explicit; pretending the column
 * stores Dates would only hide the conversion.
 */
import { z } from "zod";

import { NotificationJobKind } from "@/generated/prisma";

/** An ISO-8601 instant, as stored in a JSON payload column. */
const IsoInstant = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected an ISO-8601 timestamp",
  });

/**
 * Fields every evaluation payload carries.
 *
 * `occurrenceKey` is the idempotency identity of this evaluation — see
 * `occurrence.ts`. `evaluatedAt` is the instant the scheduler decided this work
 * existed, and is the only "now" an evaluation is allowed to use.
 */
const EvaluationBase = z.object({
  userId: z.string().min(1),
  occurrenceKey: z.string().min(1),
  evaluatedAt: IsoInstant,
});

export const EvaluateTopRelevantCompetitionPayloadSchema =
  EvaluationBase.strict();

export const EvaluateRegistrationClosingPayloadSchema = EvaluationBase.extend({
  /** Inclusive lower bound of the deadline band (ND-I-19). */
  windowStart: IsoInstant,
  /** Exclusive upper bound. */
  windowEnd: IsoInstant,
}).strict();

export const FanoutAnnouncementPayloadSchema = z
  .object({
    announcementId: z.string().min(1),
    occurrenceKey: z.string().min(1),
    evaluatedAt: IsoInstant,
    /**
     * The last user id this fan-out reached, or null on the first page.
     *
     * Fan-out re-arms its own row with an advanced cursor rather than
     * enqueueing a successor job — a successor would carry the same dedupe key
     * and collide with the row that created it.
     */
    cursor: z.string().min(1).nullable().default(null),
    /** Users processed so far, for observability rather than control flow. */
    processed: z.number().int().min(0).default(0),
  })
  .strict();

/**
 * Fan one suggestion's review notice out to every reviewer.
 *
 * Carries `submittedAt` as well as the occurrence key, even though the key
 * already embeds it. The key is an opaque identity string the database
 * deduplicates on; `submittedAt` is a value the handler *compares* against the
 * suggestion's current row to detect a resubmission that happened after this
 * job was scheduled. Re-parsing an instant out of a key would work and would be
 * the kind of cleverness that breaks the moment the key format changes.
 */
export const NotifyAdminsOfSuggestionPayloadSchema = z
  .object({
    suggestionId: z.string().min(1),
    occurrenceKey: z.string().min(1),
    evaluatedAt: IsoInstant,
    /** The submission this notice is about — frozen at discovery (ND-D-07). */
    submittedAt: IsoInstant,
    /** Last reviewer id reached, or null on the first page. */
    cursor: z.string().min(1).nullable().default(null),
    processed: z.number().int().min(0).default(0),
  })
  .strict();

export const DeliverNotificationPayloadSchema = z
  .object({
    notificationId: z.string().min(1),
  })
  .strict();

/**
 * One schema per job kind.
 *
 * Keyed exhaustively, so adding a `NotificationJobKind` without a payload
 * contract is a compile error rather than a runtime surprise in a worker.
 */
export const JOB_PAYLOAD_SCHEMAS = {
  [NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION]:
    EvaluateTopRelevantCompetitionPayloadSchema,
  [NotificationJobKind.EVALUATE_REGISTRATION_CLOSING]:
    EvaluateRegistrationClosingPayloadSchema,
  [NotificationJobKind.FANOUT_ANNOUNCEMENT]: FanoutAnnouncementPayloadSchema,
  [NotificationJobKind.NOTIFY_ADMINS_OF_SUGGESTION]:
    NotifyAdminsOfSuggestionPayloadSchema,
  [NotificationJobKind.DELIVER_NOTIFICATION]: DeliverNotificationPayloadSchema,
} as const satisfies Record<NotificationJobKind, z.ZodType>;

export type JobPayloadByKind = {
  [K in NotificationJobKind]: z.infer<(typeof JOB_PAYLOAD_SCHEMAS)[K]>;
};

export type JobPayloadFor<K extends NotificationJobKind> = JobPayloadByKind[K];

/** Any valid job payload, before its kind is known. */
export type AnyJobPayload = JobPayloadByKind[NotificationJobKind];

/**
 * Parses a raw payload against its kind's contract.
 *
 * Throws `ZodError` on a mismatch, which the runner treats as a **permanent**
 * failure: a payload that does not match its schema will not start matching on
 * a retry, and retrying it would burn attempts to reach the same conclusion.
 */
export function parseJobPayload<K extends NotificationJobKind>(
  kind: K,
  raw: unknown,
): JobPayloadFor<K> {
  return JOB_PAYLOAD_SCHEMAS[kind].parse(raw) as JobPayloadFor<K>;
}
