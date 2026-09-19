import {
  ProjectStatus,
  ProjectVisibility,
} from "@/generated/prisma";

export interface ProjectQueryDto {
  search?: string;

  status?: ProjectStatus;

  visibility?: ProjectVisibility;

  category?: string;

  technology?: string;

  memberId?: string;

  featured?: boolean;

  page: number;

  limit: number;

  sort:
    | "newest"
    | "oldest"
    | "updated"
    | "alphabetical"
    | "start-date";
}