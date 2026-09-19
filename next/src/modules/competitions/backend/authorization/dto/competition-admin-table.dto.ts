import type { CompetitionManagementTableDTO } from "./competition-management-table.dto";

/**
 * The admin table's row shape — everything a management table row has, plus
 * the one field only the admin scope may ever return.
 *
 * Deliberately a separate type rather than an added field on
 * `CompetitionManagementTableDTO` itself. That shared DTO also backs
 * `searchManageable` (an organizer's own listing), which never returns a
 * soft-deleted row — `deletedAt` would exist on every one of its responses
 * only to always be `null`. A field whose only value on one scope is "always
 * absent" is not a field that scope should carry at all. Keeping it here
 * instead means it is structurally impossible for a deletion-state field to
 * appear on a management-scope response — there is nowhere on that DTO for
 * it to be.
 */
export interface CompetitionAdminTableDTO extends CompetitionManagementTableDTO {
  readonly deletedAt: Date | null;

  /**
   * Whether the current actor may restore this row, computed the same way
   * every other permission on this DTO is: from the policy, never inferred
   * by the UI from role or from `deletedAt` alone. Lives here rather than on
   * the shared `permissions` object for the same reason `deletedAt` does —
   * it is only ever meaningful on this scope's rows.
   */
  readonly canRestore: boolean;

  /**
   * Whether automatic lifecycle status management is turned off for this
   * row. Admin-scope only, for the same reason `deletedAt` is: it exists to
   * drive a small indicator on the admin table, not something a
   * self-management listing has any use for.
   */
  readonly automaticStatusUpdatesDisabled: boolean;
}
