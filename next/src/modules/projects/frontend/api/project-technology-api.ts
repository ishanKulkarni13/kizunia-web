import { HttpClient } from "@/lib/http/client";

import type { ProjectTechnologyDto } from "../../backend/dto/output";
import type {
  AttachProjectTechnologyInput,
  ReorderProjectTechnologiesInput,
} from "../../schemas/project-technology.schema";

/**
 * Technologies are a sub-resource with their own endpoints rather than part
 * of the project profile PATCH, so every call here returns the project's
 * full, server-ordered list — the caller never has to re-derive ordering
 * locally. Mirrors `ProjectLinkApi`.
 */
export class ProjectTechnologyApi {
  static async list(projectId: string): Promise<ProjectTechnologyDto[]> {
    const response = await HttpClient.get<ProjectTechnologyDto[]>(
      `/api/v1/projects/${projectId}/technologies`,
    );

    return response.data;
  }

  static async attach(
    projectId: string,
    dto: AttachProjectTechnologyInput,
  ): Promise<ProjectTechnologyDto[]> {
    const response = await HttpClient.post<
      ProjectTechnologyDto[],
      AttachProjectTechnologyInput
    >(`/api/v1/projects/${projectId}/technologies`, dto);

    return response.data;
  }

  static async detach(
    projectId: string,
    technologyId: string,
  ): Promise<ProjectTechnologyDto[]> {
    const response = await HttpClient.delete<ProjectTechnologyDto[]>(
      `/api/v1/projects/${projectId}/technologies/${technologyId}`,
    );

    return response.data;
  }

  static async reorder(
    projectId: string,
    dto: ReorderProjectTechnologiesInput,
  ): Promise<ProjectTechnologyDto[]> {
    const response = await HttpClient.patch<
      ProjectTechnologyDto[],
      ReorderProjectTechnologiesInput
    >(`/api/v1/projects/${projectId}/technologies`, dto);

    return response.data;
  }
}
