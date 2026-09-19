import { HttpClient } from "@/lib/http/client";

import type { ProjectLinkDto } from "../../backend/dto/output";
import type {
  CreateProjectLinkInput,
  ReorderProjectLinksInput,
  UpdateProjectLinkInput,
} from "../../schemas/project-link.schema";

/**
 * Links are a sub-resource with their own endpoints rather than part of the
 * project profile PATCH, so every call here returns the project's full,
 * server-ordered list — the caller never has to re-derive ordering locally.
 */
export class ProjectLinkApi {
  static async list(projectId: string): Promise<ProjectLinkDto[]> {
    const response = await HttpClient.get<ProjectLinkDto[]>(
      `/api/v1/projects/${projectId}/links`,
    );

    return response.data;
  }

  static async create(
    projectId: string,
    dto: CreateProjectLinkInput,
  ): Promise<ProjectLinkDto[]> {
    const response = await HttpClient.post<
      ProjectLinkDto[],
      CreateProjectLinkInput
    >(`/api/v1/projects/${projectId}/links`, dto);

    return response.data;
  }

  static async update(
    projectId: string,
    linkId: string,
    dto: UpdateProjectLinkInput,
  ): Promise<ProjectLinkDto[]> {
    const response = await HttpClient.patch<
      ProjectLinkDto[],
      UpdateProjectLinkInput
    >(`/api/v1/projects/${projectId}/links/${linkId}`, dto);

    return response.data;
  }

  static async delete(
    projectId: string,
    linkId: string,
  ): Promise<ProjectLinkDto[]> {
    const response = await HttpClient.delete<ProjectLinkDto[]>(
      `/api/v1/projects/${projectId}/links/${linkId}`,
    );

    return response.data;
  }

  static async reorder(
    projectId: string,
    dto: ReorderProjectLinksInput,
  ): Promise<ProjectLinkDto[]> {
    const response = await HttpClient.patch<
      ProjectLinkDto[],
      ReorderProjectLinksInput
    >(`/api/v1/projects/${projectId}/links`, dto);

    return response.data;
  }
}
