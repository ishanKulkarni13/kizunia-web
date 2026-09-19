/**
 * Per-row admin-table permissions.
 *
 * Mirrors the convention seen on Competition's admin DTOs (e.g.
 * `CompetitionManagementTableDTO`'s `permissions` field / `CompetitionAdminTableDTO.canRestore`),
 * kept minimal here because Technology has no per-resource role system —
 * every field is derived from the single platform-level
 * `MANAGE_TECHNOLOGIES` gate plus the row's own `deletedAt`, not from a
 * per-row policy evaluation.
 */
export interface TechnologyPermissionsDTO {
    readonly canEdit: boolean;
    readonly canDelete: boolean;
    readonly canRestore: boolean;
}
