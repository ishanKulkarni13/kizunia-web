import { HttpClient } from "@/lib/http/client";

// Type-only imports from `backend/`: they erase at compile time, so no server
// code reaches the browser bundle, and there stays one definition of each shape.
import type { GrantPlanDTO } from "../backend/grants/grant.dto";
import type { PromotionDTO, PromotionEligibilityDTO, PromotionListDTO } from "../backend/grants/promotion.dto";

const BASE_URL = "/api/v1/admin/billing/promotions";

export interface CreatePromotionBody {
  readonly code: string;
  readonly plan: GrantPlanDTO;
  readonly durationDays: number;
  /** Total redemptions allowed, or `null` for no limit. */
  readonly maxRedemptions: number | null;
  /** ISO 8601; defaults to now on the server. */
  readonly validFrom?: string;
  /** ISO 8601, or `null` for never. */
  readonly validUntil: string | null;
  readonly eligibility: PromotionEligibilityDTO;
}

export interface PromotionListParams {
  readonly page?: number;
  readonly limit?: number;
}

/** Admin promotions (`MANAGE_ENTITLEMENT_GRANTS`, enforced by the API). */
export class PromotionApi {
  static async list(params: PromotionListParams = {}): Promise<PromotionListDTO> {
    const search = new URLSearchParams();

    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));

    const query = search.toString();
    const response = await HttpClient.get<PromotionListDTO>(query ? `${BASE_URL}?${query}` : BASE_URL);

    return response.data;
  }

  static async create(body: CreatePromotionBody): Promise<PromotionDTO> {
    const response = await HttpClient.post<PromotionDTO, CreatePromotionBody>(BASE_URL, body);

    return response.data;
  }
}
