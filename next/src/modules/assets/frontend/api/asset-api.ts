import { HttpClient } from "@/lib/http/client";

import type { AssetDTO, AssetPurpose } from "../types";

export interface CreateUploadIntentInput {
  purpose: AssetPurpose;
  targetEntityType?: string;
  targetEntityId?: string;
  declaredMimeType: string;
  declaredSize: number;
}

export interface UploadIntentResponse {
  intentId: string;
  provider: "CLOUDINARY";
  uploadUrl: string;
  params: Record<string, string | number>;
  expiresAt: string;
}

export class AssetApi {
  static async createUploadIntent(
    input: CreateUploadIntentInput,
  ): Promise<UploadIntentResponse> {
    const response = await HttpClient.post<
      UploadIntentResponse,
      CreateUploadIntentInput
    >("/api/v1/assets/upload-intent", input);

    return response.data;
  }

  static async finalize(intentId: string): Promise<AssetDTO> {
    const response = await HttpClient.post<AssetDTO, { intentId: string }>(
      "/api/v1/assets/finalize",
      { intentId },
    );

    return response.data;
  }
}
