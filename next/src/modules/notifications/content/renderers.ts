/**
 * Notifications — Content Renderers
 *
 * Pure. Turn a decision into the words a user reads.
 *
 * ## The trade-off this file makes, deliberately
 *
 * `clients-and-channels.md` warns that the realistic way this subsystem becomes
 * web-coupled is not interfaces but **content**: a title, body or link baked at
 * generation time in a form only the web client can render. The record looks
 * portable, is not, and nothing in the type system notices.
 *
 * Content is nonetheless rendered here, at generation, rather than at read time.
 * Two reasons, both about correctness rather than convenience:
 *
 *  - a push has to carry its own words. There is no client to render it, and a
 *    notification whose text only exists once someone opens the inbox cannot be
 *    pushed at all;
 *  - history must not be rewritten. A competition renamed next week must not
 *    change what the user was told today (ND-H-02), which a render-at-read-time
 *    design cannot promise.
 *
 * The mitigation is that every draft also carries a **structured payload** and
 * typed target rows. The rendered strings are what the web client and the push
 * use; the payload is what a future client re-renders from. That is not free —
 * it is two representations of the same fact — but it is the price of being
 * able to push at all, and it is paid explicitly rather than discovered later.
 *
 * There is deliberately no template engine. Four intents, one sentence each.
 */
import { NotificationIntent, NotificationTargetType } from "@/generated/prisma";
import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";

import type { NotificationSubject } from "../policy/types";
import {
  adminSuggestionPath,
  competitionPath,
  safeActionPathOrNull,
} from "./action-path";
import type { NotificationDraft, NotificationTargetDraft } from "./notification-draft";

/** The snapshot of one competition kept on the notification. */
interface CompetitionSnapshot {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly organizer: string | null;
  readonly registrationDeadline: string | null;
  readonly logoUrl: string | null;
}

function snapshot(competition: CompetitionCardDTO): CompetitionSnapshot {
  return {
    id: competition.id,
    slug: competition.slug,
    title: competition.title,
    organizer: competition.organizer,
    registrationDeadline: competition.registrationDeadline?.toISOString() ?? null,
    logoUrl: competition.logoUrl,
  };
}

function targetsFrom(
  subjects: readonly NotificationSubject[],
): NotificationTargetDraft[] {
  return subjects.map((subject, index) => ({
    targetType: NotificationTargetType.COMPETITION,
    targetId: subject.competitionId,
    targetVersion: subject.occasionVersion ?? null,
    // The rank the user sees, which is position in this notification — not the
    // engine's global rank, which would be a meaningless number out of context.
    rank: index + 1,
  }));
}

/**
 * "Here is a competition that is particularly relevant to you."
 *
 * Exactly one subject (ND-I-06). The competition's own title carries the
 * message, so the notification's title stays short and the body is the thing
 * worth reading — a title that repeats the competition name wastes the only
 * line a push banner reliably shows.
 */
export function renderTopRelevantCompetition(
  userId: string,
  occurrenceKey: string,
  subjects: readonly [NotificationSubject, ...NotificationSubject[]],
): NotificationDraft {
  const [top] = subjects;
  const competition = top.competition;

  const organizerSuffix = competition.organizer ? ` by ${competition.organizer}` : "";

  return {
    userId,
    intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
    occurrenceKey,
    title: "A competition worth a look",
    body: `${competition.title}${organizerSuffix} matches what you're interested in.`,
    actionPath: safeActionPathOrNull(competitionPath(competition.slug)),
    payload: { competitions: [snapshot(competition)] },
    targets: targetsFrom(subjects),
  };
}

/**
 * "Registration closes soon on these."
 *
 * One summary covering several competitions (ND-I-13). The wording changes with
 * the count because "1 competitions" is the kind of detail that makes a product
 * feel unattended, and pluralisation is not worth a localisation framework here.
 */
export function renderRegistrationClosing(
  userId: string,
  occurrenceKey: string,
  subjects: readonly [NotificationSubject, ...NotificationSubject[]],
): NotificationDraft {
  const competitions = subjects.map((subject) => subject.competition);
  const [first] = competitions;

  const body =
    competitions.length === 1
      ? `Registration for ${first.title} closes soon.`
      : `${competitions.length} competitions you're interested in have registration closing soon.`;

  return {
    userId,
    intent: NotificationIntent.REGISTRATION_CLOSING,
    occurrenceKey,
    title: "Registration closing soon",
    body,
    // A single competition links straight to it; a summary links to the list,
    // because there is no one competition it is "about".
    actionPath:
      competitions.length === 1
        ? safeActionPathOrNull(competitionPath(first.slug))
        : "/competitions",
    payload: { competitions: competitions.map(snapshot) },
    targets: targetsFrom(subjects),
  };
}

export interface AnnouncementContent {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Already validated: an https URL, or a site-relative path. */
  readonly url: string | null;
}

/**
 * An admin-authored announcement, verbatim.
 *
 * The only notification whose words a human wrote, and the only one whose
 * action may leave Kizunia. `actionPath` therefore takes the link only when it
 * is site-relative — an external URL is kept in the payload, where the client
 * renders it as what it is rather than as an in-app route.
 */
export function renderFeatureAnnouncement(
  userId: string,
  occurrenceKey: string,
  announcement: AnnouncementContent,
): NotificationDraft {
  const internalPath = safeActionPathOrNull(announcement.url);

  return {
    userId,
    intent: NotificationIntent.FEATURE_ANNOUNCEMENT,
    occurrenceKey,
    title: announcement.title,
    body: announcement.body,
    actionPath: internalPath,
    payload: {
      announcementId: announcement.id,
      // Present only when it is not the action path, so a client never has to
      // work out which of two fields to trust.
      externalUrl: internalPath ? null : announcement.url,
    },
    targets: [
      {
        targetType: NotificationTargetType.ANNOUNCEMENT,
        targetId: announcement.id,
        targetVersion: null,
        rank: 1,
      },
    ],
  };
}

export interface SuggestionContent {
  readonly id: string;
  readonly title: string;
  /** Display name of whoever submitted it, or null if it cannot be resolved. */
  readonly submittedBy: string | null;
  readonly submittedAt: Date;
}

/**
 * "Someone suggested a competition; it is waiting for review."
 *
 * The one intent addressed to a person in a *role* rather than to a person
 * about their own interests, and the copy reflects that: it names the work and
 * where to do it, with no persuasion, because the recipient is not being
 * invited to be interested — they are being told their queue has something in
 * it.
 *
 * Exactly one subject. Deliberately not aggregated the way the deadline summary
 * is (ND-I-13): a suggestion is a unit of work someone opens, acts on and
 * closes, so one notification per item is what makes the inbox usable as a
 * worklist. Collapsing five into "5 suggestions awaiting review" would be a
 * digest, and would also destroy the per-item read state that makes the inbox
 * worth checking.
 *
 * `submittedAt` is carried in the payload, not in the body. It is what
 * distinguishes one occasion of a resubmitted suggestion from the next
 * (ND-H-12), and a client that wants to show "submitted 40 minutes ago" can
 * compute it; baking a relative time into a stored string would be wrong within
 * the hour.
 */
export function renderAdminSuggestionReview(
  recipientId: string,
  occurrenceKey: string,
  suggestion: SuggestionContent,
): NotificationDraft {
  const submitterSuffix = suggestion.submittedBy
    ? ` from ${suggestion.submittedBy}`
    : "";

  return {
    userId: recipientId,
    intent: NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
    occurrenceKey,
    title: "New competition suggestion",
    body: `"${suggestion.title}"${submitterSuffix} is waiting for review.`,
    actionPath: safeActionPathOrNull(adminSuggestionPath(suggestion.id)),
    payload: {
      suggestionId: suggestion.id,
      suggestionTitle: suggestion.title,
      submittedBy: suggestion.submittedBy,
      submittedAt: suggestion.submittedAt.toISOString(),
    },
    targets: [
      {
        targetType: NotificationTargetType.COMPETITION_SUGGESTION,
        targetId: suggestion.id,
        // The occasion, so history can tell a first submission from a
        // resubmission of the same suggestion (ND-H-12).
        targetVersion: suggestion.submittedAt.toISOString(),
        rank: 1,
      },
    ],
  };
}
