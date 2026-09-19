import {
  ProjectVisibility,
} from "@/generated/prisma";

/**
 * @deprecated Superseded by the split, per-section update contracts:
 * `UpdateProjectProfileDto` (title/slug/shortDescription/status/visibility)
 * and `UpdateProjectContentDto` (content). Do not add new fields here or
 * introduce new callers.
 */
export interface UpdateProjectDto {
  title?: string;

  slug?: string;

  shortDescription?: string;

  content?: string;

  visibility?: ProjectVisibility;

  logoAssetId?: string | null;

  coverAssetId?: string | null;

  categoryIds?: string[];

  technologyIds?: string[];

  badgeIds?: string[];

//   linkIds?: string[];

  startDate?: Date | null;

  endDate?: Date | null;
}