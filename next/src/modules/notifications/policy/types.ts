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
  | "NO_RECOMMENDATIONS";

/**
 * The one competition a notification would be about.
 *
 * `competitionId` is lifted out of `competition` deliberately: the eventual
 * deduplication key is `(user, competition, intent)`
 * (`docs/project/feature-specification/notification/decisions/history.md`,
 * ND-H-03), and a future notification record should not have to reach into a
 * display DTO to find its own identity.
 */
export interface NotificationSubject {
  readonly competitionId: string;
  readonly competition: CompetitionCardDTO;
  readonly score: number;
  readonly rank: number;
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
 */
export type NotificationDecision =
  | {
      readonly eligible: true;
      readonly intent: NotificationIntent;
      readonly userId: string;
      readonly evaluatedAt: Date;
      readonly subject: NotificationSubject;
    }
  | {
      readonly eligible: false;
      readonly intent: NotificationIntent;
      readonly userId: string;
      readonly evaluatedAt: Date;
      readonly reason: NotificationSuppressionReason;
    };
