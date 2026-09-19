import { HttpClient } from "@/lib/http/client";
import type { PaginationMeta } from "@/lib/search";

import type {
  AssetAdminDetailDTO,
  AssetAdminListRowDTO,
  AssetAdminSummaryDTO,
  AssetReconciliationApplyResultDTO,
  AssetReconciliationCandidateDTO,
  AssetReconciliationPreviewSummaryDTO,
} from "../dto/asset-admin.dto";

export class AssetAdminApi {
  static async search(
    params: Record<string, string> = {},
  ): Promise<{ items: AssetAdminListRowDTO[]; pagination: PaginationMeta }> {
    const query = new URLSearchParams(params).toString();

    const response = await HttpClient.get<{
      items: AssetAdminListRowDTO[];
      pagination: PaginationMeta;
    }>(`/api/v1/admin/assets${query ? `?${query}` : ""}`);

    return response.data;
  }

  static async getById(id: string): Promise<AssetAdminDetailDTO> {
    const response = await HttpClient.get<AssetAdminDetailDTO>(
      `/api/v1/admin/assets/${id}`,
    );

    return response.data;
  }

  /**
   * Not a fetch — the download endpoint is a redirect, so the UI links to
   * it directly (`<a href={AssetAdminApi.downloadUrl(id)}>`) rather than
   * calling it via `HttpClient`. This exists purely to avoid hand-building
   * the path in more than one component.
   */
  static downloadUrl(id: string): string {
    return `/api/v1/admin/assets/${id}/download`;
  }

  static async previewReconciliation(
    params: Record<string, string> = {},
  ): Promise<{
    items: AssetReconciliationCandidateDTO[];
    pagination: PaginationMeta;
    summary: AssetReconciliationPreviewSummaryDTO;
  }> {
    const query = new URLSearchParams(params).toString();

    const response = await HttpClient.get<{
      items: AssetReconciliationCandidateDTO[];
      pagination: PaginationMeta;
      summary: AssetReconciliationPreviewSummaryDTO;
    }>(`/api/v1/admin/assets/reconciliation/preview${query ? `?${query}` : ""}`);

    return response.data;
  }

  static async applyReconciliation(
    ids: string[],
  ): Promise<AssetReconciliationApplyResultDTO> {
    const response = await HttpClient.post<
      AssetReconciliationApplyResultDTO,
      { ids: string[] }
    >("/api/v1/admin/assets/reconciliation/apply", { ids });

    return response.data;
  }
}

export type { AssetAdminSummaryDTO };
