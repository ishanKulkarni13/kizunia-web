/**
 * Notification policy — should admins still be told about this suggestion?
 *
 * Pure, over already-fetched inputs, like every other policy in this folder.
 * No database, no clock, no I/O.
 *
 * ## Why this is its own decision type
 *
 * `NotificationDecision` in `types.ts` is competition-shaped: its subject
 * carries a `CompetitionCardDTO`, a relevance score and an engine rank. That
 * shape is not incidental — it is what makes the two recommendation-driven
 * intents share one vocabulary.
 *
 * A suggestion awaiting review has none of those things. It is not scored, not
 * ranked, and not a competition; it is a queue item. Forcing it through the
 * competition-shaped union would mean inventing a score nobody computed and a
 * rank that means nothing, and every consumer of `NotificationSubject` would
 * then have to tolerate those fabrications. A separate five-line union is
 * cheaper than that, and honest about being a different kind of decision.
 *
 * ## What is *not* decided here
 *
 * Who receives it. Recipients come from the platform permission set, resolved
 * against the database by the handler; this file answers only "is there still
 * anything to say, and does this particular person want to hear it".
 *
 * That split is what keeps the expensive question (a paged query over admin
 * users) out of a function that has to run once per recipient.
 */
import type { SuggestionStatus } from "@/generated/prisma";

/**
 * Why no notice was produced.
 *
 * Distinct values rather than one "not eligible", because these three are
 * genuinely different events and the log line is the only trace a suppressed
 * notification leaves. "The queue item was handled inside the grace window" and
 * "this admin switched these off" must not read the same afterwards.
 */
export type AdminSuggestionSuppressionReason =
  /**
   * The suggestion left the review queue between discovery and this evaluation
   * — reviewed, withdrawn, reopened for changes, or soft-deleted.
   *
   * The expected outcome for anything handled inside the notice delay, and the
   * reason that delay is worth having (ND-D-12: state is re-checked immediately
   * before sending, never assumed from when the work was scheduled).
   */
  | "NO_LONGER_AWAITING_REVIEW"
  /**
   * The suggestion was resubmitted after this job was scheduled, so a later
   * occasion now exists and will produce its own notice.
   *
   * Suppressing the older one is what stops a rapid edit-resubmit cycle from
   * filling the inbox with notices about states that no longer exist.
   */
  | "SUPERSEDED_BY_RESUBMISSION"
  /** This recipient has the intent switched off. */
  | "INTENT_DISABLED"
  /**
   * The recipient submitted this suggestion themselves.
   *
   * An admin who suggests a competition already knows it is in the queue;
   * telling them is noise, and telling them to review their own submission is
   * worse than noise.
   */
  | "RECIPIENT_IS_SUBMITTER";

/** What the policy needs to know about the suggestion, and nothing more. */
export interface AdminSuggestionState {
  readonly status: SuggestionStatus;
  readonly deletedAt: Date | null;
  readonly reviewedAt: Date | null;
  /** Null is impossible for a submitted suggestion, and treated as not-awaiting. */
  readonly submittedAt: Date | null;
  readonly submittedById: string;
}

export type AdminSuggestionDecision =
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly reason: AdminSuggestionSuppressionReason;
    };

/**
 * Whether the suggestion is still the thing the job was scheduled about.
 *
 * Answered once per job rather than once per recipient: it does not depend on
 * who is being told.
 *
 * `expectedSubmittedAt` is the instant frozen into the job payload at discovery
 * (ND-D-07). Comparing against it — rather than merely checking the status — is
 * what catches the resubmission case, where the suggestion is legitimately
 * `UNDER_REVIEW` again but for a *different* occasion than this job describes.
 */
export function isSuggestionStillAwaitingReview(
  state: AdminSuggestionState,
  expectedSubmittedAt: Date,
): AdminSuggestionDecision {
  if (
    state.deletedAt !== null ||
    state.reviewedAt !== null ||
    state.submittedAt === null ||
    state.status !== "UNDER_REVIEW"
  ) {
    return { eligible: false, reason: "NO_LONGER_AWAITING_REVIEW" };
  }

  if (state.submittedAt.getTime() !== expectedSubmittedAt.getTime()) {
    return { eligible: false, reason: "SUPERSEDED_BY_RESUBMISSION" };
  }

  return { eligible: true };
}

/**
 * Whether this particular recipient should be told.
 *
 * Takes `intentEnabled` already resolved rather than a preference row, because
 * "no row" means enabled for this intent (it defaults on, like announcements)
 * and resolving that default is the caller's job — the same inversion the
 * announcement fan-out query makes.
 */
export function shouldNotifyReviewer(
  input: {
    readonly recipientId: string;
    readonly intentEnabled: boolean;
  },
  state: AdminSuggestionState,
): AdminSuggestionDecision {
  if (input.recipientId === state.submittedById) {
    return { eligible: false, reason: "RECIPIENT_IS_SUBMITTER" };
  }

  if (!input.intentEnabled) {
    return { eligible: false, reason: "INTENT_DISABLED" };
  }

  return { eligible: true };
}
