/**
 * Permissions available to the current actor for a competition.
 *
 * These are computed on the server using the authorization policy.
 * The frontend should never infer permissions from roles.
 */
export interface CompetitionPermissionsDTO {
  canView: boolean;

  canEdit: boolean;

  canDelete: boolean;

  canPublish: boolean;

  canUnpublish: boolean;

  canManageMembers: boolean;

  canManageMedia: boolean;

  canManageLinks: boolean;

  canManageTechnologies: boolean;

  canManageEligibility: boolean;
}