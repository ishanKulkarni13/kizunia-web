import { CompetitionRegistrationRepository } from "./competition-registration.repository";

export class CompetitionRegistrationService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Repository orchestration
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate users
   * ✗ Authorize users — the controller resolves competition context and
   *   calls `CompetitionAuthorizer.read` before `mark` runs, reusing the
   *   same viewability rule as every other public read.
   * ✗ Query Prisma directly
   *
   * A `CompetitionRegistration` row is the user's own, unverified claim
   * that they registered on the organizer's external platform. It is
   * fully independent of `CompetitionBookmark`: this class never imports
   * `CompetitionBookmarkRepository`, and no write here ever touches that
   * table.
   *
   * IMPORTANT — there is deliberately NO `CompetitionStatus` check here.
   * Marking as registered is allowed at every status, including
   * REGISTRATION_CLOSED, ONGOING, COMPLETED and CANCELLED: Kizunia does
   * not own registration and cannot know it has actually closed for this
   * user, and a user may be recording a registration that already
   * happened. Do not add a "registration is closed" guard — that is
   * exactly the well-meaning validation this comment exists to head off.
   *
   * Registrations are never removed automatically. No lifecycle
   * transition, and no admin action on the competition, calls into this
   * service — only the user's own explicit request does.
   */

  /**
   * Records that the given user registered for this competition.
   * Idempotent: marking an already-marked competition succeeds without
   * changing `markedAt`.
   *
   * Callers must resolve and authorize the competition (view access)
   * before calling this — see `CompetitionController.setRegistration`.
   */
  static async mark(competitionId: string, userId: string): Promise<void> {
    await CompetitionRegistrationRepository.upsert(competitionId, userId);
  }

  /**
   * Clears a user's registration mark, if one exists.
   *
   * Deliberately unconditional — no existence check, no visibility guard,
   * no status check. Removing your own mark must always be possible. A
   * no-op (nothing was marked) is not an error.
   */
  static async unmark(competitionId: string, userId: string): Promise<void> {
    await CompetitionRegistrationRepository.deleteMany(competitionId, userId);
  }
}
