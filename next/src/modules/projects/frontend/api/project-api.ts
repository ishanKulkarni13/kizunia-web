import { HttpClient } from "@/lib/http/client";
import { UpdateProjectProfileDto, UpdateProjectContentDto } from "../../backend/dto/input";
import { CreateProjectDto } from "../../schemas";
import { ProjectDetailsDto, ProjectMineSummaryDto } from "../../backend/dto/output";
import type { ProjectMineQueryInput } from "../../search/mine-schema";
import type { SearchResult } from "@/lib/search/types";
import type { SetAssetInput } from "@/modules/assets/schemas/set-asset";
import type { ProjectAssetSlot } from "../../types/asset-slot";



export class ProjectApi {
  static async findMine(
    params: Partial<ProjectMineQueryInput>,
  ): Promise<SearchResult<ProjectMineSummaryDto>> {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    });

    const query = searchParams.toString();

    const response = await HttpClient.get<SearchResult<ProjectMineSummaryDto>>(
      `/api/v1/projects/mine${query ? `?${query}` : ""}`,
    );

    return response.data;
  }

  static async create(
    dto: CreateProjectDto,
  ): Promise<ProjectDetailsDto> {
    const response = await HttpClient.post<
      ProjectDetailsDto,
      CreateProjectDto
    >(
      "/api/v1/projects",
      dto,
    );

    return response.data;
  }

  static async getById(
    id: string,
  ): Promise<ProjectDetailsDto> {
    const response = await HttpClient.get<ProjectDetailsDto>(
      `/api/v1/projects/${id}`,
    );

    return response.data;
  }

  static async updateProfile(
    id: string,
    dto: UpdateProjectProfileDto,
  ): Promise<ProjectDetailsDto> {
    const response = await HttpClient.patch<
      ProjectDetailsDto,
      UpdateProjectProfileDto
    >(
      `/api/v1/projects/${id}`,
      dto,
    );

    return response.data;
  }

  static async updateContent(
    id: string,
    dto: UpdateProjectContentDto,
  ): Promise<ProjectDetailsDto> {
    const response = await HttpClient.patch<
      ProjectDetailsDto,
      UpdateProjectContentDto
    >(
      `/api/v1/projects/${id}/content`,
      dto,
    );

    return response.data;
  }

  static async setAsset(
    id: string,
    slot: ProjectAssetSlot,
    input: SetAssetInput,
  ): Promise<ProjectDetailsDto> {
    const response = await HttpClient.patch<
      ProjectDetailsDto,
      SetAssetInput
    >(
      `/api/v1/projects/${id}/assets/${slot}`,
      input,
    );

    return response.data;
  }

  static async clearAsset(
    id: string,
    slot: ProjectAssetSlot,
  ): Promise<ProjectDetailsDto> {
    return this.setAsset(id, slot, { assetId: null });
  }

  static async delete(
    id: string,
  ): Promise<void> {
    await HttpClient.delete<Record<string, never>>(
      `/api/v1/projects/${id}`,
    );
  }
}