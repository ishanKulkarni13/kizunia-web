/**
 * Notification policy — decision contract.
 *
 * The vocabulary of the question "should this become a notification?", and
 * nothing else. These types are intent-agnostic on purpose: a second intent
 * reuses them rather than growing a parallel set.
 *
 * Pure types only — no Prisma runtime import, no I/O. `NotificationIntent`
 * is imported as a type so this file stays free of the generated client.
 */
import type { NotificationIntent } from "@/generated/prisma";
import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";

/**
 * Why no notification was produced. Each value is a distinct, reportable
 * outcome — "we found nothing" and "the user asked us not to" are different
 * facts and must never collapse into one.
 */
export type NotificationSuppressionReason =
  /** The user has this intent off, or has never turned it on (opt-in default). */
  | "INTENT_DISABLED"
  /** Nothing cleared the recommendation engine's relevance threshold. */
  | "NO_RECOMMENDATIONS"
  /**
   * Relevant competitions exist, but none has a deadline inside the window this
   * evaluation is responsible for. The normal outcome on most days.
   */
  | "NO_SUBJECTS_IN_WINDOW"
  /**
   * Everything that qualified has already been delivered to this user for this
   * intent and this occasion (ND-H-03). Distinct from finding nothing: the
   * system worked, and staying quiet is the correct result.
   */
  | "ALREADY_NOTIFIED";

/**
 * A competition a notification would be about.
 *
 * `competitionId` is lifted out of `competition` deliberately: the
 * deduplication key is `(user, competition, intent)`
 * (`docs/project/feature-specification/notification/decisions/history.md`,
 * ND-H-03), and a notification record should not have to reach into a display
 * DTO to find its own identity.
 *
 * `occasionVersion` distinguishes *which occurrence* of this subject is being
 * notified about — the registration deadline, for the deadline intent (ND-H-12).
 * A moved deadline is a new occasion and may notify again; an unchanged one is
 * a duplicate. Null for a subject that cannot recur, such as discovery, which
 * happens once per competition per user by definition.
 */
export interface NotificationSubject {
  readonly competitionId: string;
  readonly competition: CompetitionCardDTO;
  readonly score: number;
  readonly rank: number;
  readonly occasionVersion?: string | null;
}

/**
 * The policy's verdict.
 *
 * A discriminated union rather than `{ eligible, subject?, reason? }` so a
 * future generation layer cannot read `subject` without first having proved
 * `eligible` — the type system enforces the boundary instead of a comment.
 *
 * `evaluatedAt` appears on both arms and is always supplied by the caller,
 * never read from the clock inside the policy: "now" is established once per
 * evaluation (`docs/architecture/notifications/pipeline/processing-context.md`),
 * and injecting it is what makes the decision deterministically testable.
 *
 * `subjects` is a collection even for an intent that selects exactly one
 * (ND-I-06). One shape for one concept: an intent that aggregates (ND-I-13) and
 * one that does not are otherwise the same decision, and giving them two
 * different shapes would push a branch into every consumer — which is precisely
 * how a type stops being intent-agnostic. It is never empty on the eligible
 * arm; nothing to say is a suppression, not an eligible decision with no
 * subjects (ND-I-05).
 */
export type NotificationDecision =
  | {
      readonly eligible: true;
      readonly intent: NotificationIntent;
      readonly userId: string;
      readonly evaluatedAt: Date;
      readonly subjects: readonly [NotificationSubject, ...NotificationSubject[]];
    }
  | {
      readonly eligible: false;
      readonly intent: NotificationIntent;
      readonly userId: string;
      readonly evaluatedAt: Date;
      readonly reason: NotificationSuppressionReason;
    };
