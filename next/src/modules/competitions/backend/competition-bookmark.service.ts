import { CompetitionBookmarkRepository } from "./competition-bookmark.repository";

export class CompetitionBookmarkService {
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
   *   calls `CompetitionAuthorizer.read` before `add` runs, reusing the
   *   same viewability rule as every other public read. There is no
   *   separate bookmark-specific visibility rule.
   * ✗ Query Prisma directly
   *
   * A bookmark means "save this for later" — never "I registered". It is
   * fully independent of `CompetitionRegistration`: this class never
   * imports `CompetitionRegistrationRepository`, and no write here ever
   * touches that table.
   *
   * Bookmarks are never removed automatically. No lifecycle transition,
   * and no admin action on the competition, calls into this service —
   * only the user's own explicit request does.
   */

  /**
   * Saves a competition for the given user. Idempotent: bookmarking an
   * already-bookmarked competition succeeds without changing `createdAt`.
   *
   * Callers must resolve and authorize the competition (view access)
   * before calling this — see `CompetitionController.setBookmark`.
   */
  static async add(competitionId: string, userId: string): Promise<void> {
    await CompetitionBookmarkRepository.upsert(competitionId, userId);
  }

  /**
   * Removes a user's bookmark, if one exists.
   *
   * Deliberately unconditional — no existence check, no visibility guard.
   * Removing your own bookmark must always be possible, including for a
   * competition that has since been archived or soft-deleted; guarding
   * this would strand bookmarks a user could never clear, which is the
   * same user-hostile outcome the "never auto-removed" guarantee exists
   * to prevent. A no-op (nothing was bookmarked) is not an error.
   */
  static async remove(competitionId: string, userId: string): Promise<void> {
    await CompetitionBookmarkRepository.deleteMany(competitionId, userId);
  }
}
