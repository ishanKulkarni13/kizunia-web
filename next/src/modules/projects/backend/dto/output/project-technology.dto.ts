import type { TechnologyType } from "@/generated/prisma";

interface ProjectTechnologyAssetDto {
  id: string;

  url: string;

  width: number | null;

  height: number | null;

  format: string | null;

  mimeType: string | null;
}

/**
 * A technology attached to a project's implementation/stack, in presentation
 * order. `id` is the Technology's id (`ProjectTechnology` has no id of its
 * own — its primary key is the `[projectId, technologyId]` composite).
 */
export interface ProjectTechnologyDto {
  id: string;

  name: string;

  slug: string;

  type: TechnologyType;

  iconAsset: ProjectTechnologyAssetDto | null;

  displayOrder: number;

  /**
   * True when the catalog entry has been retired (soft-deleted). Display
   * reads omit such a technology; this editor list keeps it so the project
   * can still remove it. The relationship row is never deleted for them.
   */
  unavailable: boolean;
}
