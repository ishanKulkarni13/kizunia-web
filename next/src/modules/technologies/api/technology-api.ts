import { HttpClient } from "@/lib/http/client";
import type { SetAssetInput } from "@/modules/assets/schemas/set-asset";
import type { PaginationMeta } from "@/lib/search";

import type { CreateTechnologyInput } from "../schemas/create-technology";
import type { UpdateTechnologyFieldsInput } from "../schemas/update-technology-fields";
import type { TechnologyAdminDTO } from "../backend/dto/technology-admin.dto";
import type { TechnologyCatalogDTO } from "../backend/dto/technology-catalog.dto";

export class TechnologyApi {
    static async search(
        params: Record<string, string> = {},
    ): Promise<{ items: TechnologyAdminDTO[]; pagination: PaginationMeta }> {
        const query = new URLSearchParams(params).toString();

        const response = await HttpClient.get<{
            items: TechnologyAdminDTO[];
            pagination: PaginationMeta;
        }>(`/api/v1/admin/technologies${query ? `?${query}` : ""}`);

        return response.data;
    }

    static async getById(id: string): Promise<TechnologyAdminDTO> {
        const response = await HttpClient.get<TechnologyAdminDTO>(
            `/api/v1/admin/technologies/${id}`,
        );

        return response.data;
    }

    static async create(
        data: CreateTechnologyInput,
    ): Promise<TechnologyAdminDTO> {
        const response = await HttpClient.post<
            TechnologyAdminDTO,
            CreateTechnologyInput
        >("/api/v1/admin/technologies", data);

        return response.data;
    }

    static async updateFields(
        id: string,
        data: UpdateTechnologyFieldsInput,
    ): Promise<TechnologyAdminDTO> {
        const response = await HttpClient.patch<
            TechnologyAdminDTO,
            UpdateTechnologyFieldsInput
        >(`/api/v1/admin/technologies/${id}`, data);

        return response.data;
    }

    static async updateSlug(
        id: string,
        slug: string,
    ): Promise<TechnologyAdminDTO> {
        const response = await HttpClient.patch<
            TechnologyAdminDTO,
            { slug: string }
        >(`/api/v1/admin/technologies/${id}/slug`, { slug });

        return response.data;
    }

    static async delete(id: string): Promise<void> {
        await HttpClient.delete(`/api/v1/admin/technologies/${id}`);
    }

    static async restore(id: string): Promise<void> {
        await HttpClient.patch(`/api/v1/admin/technologies/${id}/restore`, {});
    }

    static async setIcon(
        id: string,
        input: SetAssetInput,
    ): Promise<TechnologyAdminDTO> {
        const response = await HttpClient.post<
            TechnologyAdminDTO,
            SetAssetInput
        >(`/api/v1/admin/technologies/${id}/icon`, input);

        return response.data;
    }

    static async clearIcon(id: string): Promise<TechnologyAdminDTO> {
        const response = await HttpClient.delete<TechnologyAdminDTO>(
            `/api/v1/admin/technologies/${id}/icon`,
        );

        return response.data;
    }

    static async getCatalog(): Promise<TechnologyCatalogDTO[]> {
        const response = await HttpClient.get<TechnologyCatalogDTO[]>(
            "/api/v1/technologies/catalog",
        );

        return response.data;
    }
}
