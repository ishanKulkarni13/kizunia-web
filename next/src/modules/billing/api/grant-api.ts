import { HttpClient } from "@/lib/http/client";

// Type-only imports from `backend/`: they erase at compile time, so no server
// code reaches the browser bundle, and there stays one definition of each shape.
import type { GrantDTO, GrantListDTO, GrantPlanDTO } from "../backend/grants/grant.dto";

const BASE_URL = "/api/v1/admin/billing/grants";

export type CreateGrantBody =
  | {
      readonly userId: string;
      readonly plan: GrantPlanDTO;
      readonly durationDays: number | null;
      readonly reason: string;
    }
  | {
      readonly email: string;
      readonly plan: GrantPlanDTO;
      readonly durationDays: number | null;
      readonly reason: string;
    };

export interface ExtendGrantBody {
  /** ISO 8601, or `null` for no expiry. */
  readonly validUntil: string | null;
  readonly reason: string;
}

export interface RevokeGrantBody {
  readonly reason: string;
}

export interface GrantListParams {
  readonly email?: string;
  readonly status?: "ACTIVE" | "REVOKED";
  readonly page?: number;
  readonly limit?: number;
}

export class GrantApi {
  static async list(params: GrantListParams = {}): Promise<GrantListDTO> {
    const search = new URLSearchParams();

    if (params.email) search.set("email", params.email);
    if (params.status) search.set("status", params.status);
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));

    const query = search.toString();
    const response = await HttpClient.get<GrantListDTO>(query ? `${BASE_URL}?${query}` : BASE_URL);

    return response.data;
  }

  static async create(body: CreateGrantBody): Promise<GrantDTO> {
    const response = await HttpClient.post<GrantDTO, CreateGrantBody>(BASE_URL, body);

    return response.data;
  }

  static async extend(id: string, body: ExtendGrantBody): Promise<GrantDTO> {
    const response = await HttpClient.post<GrantDTO, ExtendGrantBody>(
      `${BASE_URL}/${encodeURIComponent(id)}/extend`,
      body,
    );

    return response.data;
  }

  static async revoke(id: string, body: RevokeGrantBody): Promise<GrantDTO> {
    const response = await HttpClient.post<GrantDTO, RevokeGrantBody>(
      `${BASE_URL}/${encodeURIComponent(id)}/revoke`,
      body,
    );

    return response.data;
  }
}
