import {
  ProjectStatus,
  ProjectVisibility,
} from "@/generated/prisma";

export interface UpdateProjectProfileDto {
  title?: string;
  slug?: string;
  shortDescription?: string;
  status?: ProjectStatus;
  visibility?: ProjectVisibility;
}