import { HttpClient } from "@/lib/http/client";
import { PortfolioEditorDto, PortfolioPublicDto } from "../../dtos";
import { UpdatePortfolioProfileDto } from "../../dtos/input/update.dto";

export class PortfolioApi {
  static async create(): Promise<PortfolioEditorDto> {
    const response = await HttpClient.post<
      PortfolioEditorDto,
      Record<string, never>
    >("/api/v1/portfolio");

    return response.data;
  }

  static async getMine(): Promise<PortfolioEditorDto> {
    const response = await HttpClient.get<PortfolioEditorDto>(
      "/api/v1/portfolio/me",
    );

    return response.data;
  }

    static async updateProfile(
    dto: UpdatePortfolioProfileDto,
  ): Promise<PortfolioEditorDto> {
    const response = await HttpClient.patch<
      PortfolioEditorDto,
      UpdatePortfolioProfileDto
    >("/api/v1/portfolio/profile", dto);

    return response.data;
  }

  static async getPublic(
    username: string,
  ): Promise<PortfolioPublicDto> {
    const response = await HttpClient.get<PortfolioPublicDto>(
      `/api/v1/portfolio/${username}`,
    );

    return response.data;
  }

  
}