/**
 * Notifications — Notification Draft
 *
 * Everything needed to persist one notification, and nothing about how it was
 * decided.
 *
 * This is the boundary that keeps principle 1 honest. The policy layer is
 * competition-shaped, because deciding competition relevance *is* a
 * competition-shaped problem. Persistence must not be: the first non-competition
 * intent — an announcement, here — has to reach the same storage without a
 * migration or a special case.
 *
 * So a draft names its subjects by type and id rather than embedding a domain
 * object. Generation stores drafts; it does not know what produced them.
 */
import type { NotificationIntent, NotificationTargetType } from "@/generated/prisma";

export interface NotificationTargetDraft {
  readonly targetType: NotificationTargetType;
  readonly targetId: string;
  /**
   * Which occurrence of this subject — the deadline timestamp, for the deadline
   * intent (ND-H-12). Null when the subject cannot recur.
   */
  readonly targetVersion: string | null;
  /** 1-based, as presented to the user. */
  readonly rank: number;
}

export interface NotificationDraft {
  readonly userId: string;
  readonly intent: NotificationIntent;
  /** The idempotency identity. Stamped by the scheduler, never recomputed. */
  readonly occurrenceKey: string;

  readonly title: string;
  readonly body: string;
  /** Site-relative, already validated. Null when there is nowhere to go. */
  readonly actionPath: string | null;

  /**
   * A structured snapshot of what the notification says, so a future client can
   * render it its own way rather than being handed a string built for the web.
   *
   * It is a *snapshot*, not a reference: a competition renamed or deleted
   * tomorrow must not rewrite what the user was told today, and the inbox must
   * render without re-reading every subject it mentions.
   */
  readonly payload: Record<string, unknown> | null;

  /** Never empty — a notification with no subject has nothing to deduplicate on. */
  readonly targets: readonly NotificationTargetDraft[];
}
