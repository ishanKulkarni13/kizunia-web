export interface ProjectPermissionsDto {
  canView: boolean;

  canEdit: boolean;

  canDelete: boolean;

  canPublish: boolean;

  canUnpublish: boolean;

  canManageMembers: boolean;

  canManageContent: boolean;

  canManageMedia: boolean;

  canManageLinks: boolean;

  canManageTechnologies: boolean;

  canManageCategories: boolean;

  canManageBadges: boolean;

  canManageTestimonials: boolean;

  canManageCompetitions: boolean;
}