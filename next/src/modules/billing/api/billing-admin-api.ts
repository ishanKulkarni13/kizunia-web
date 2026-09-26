import { HttpClient } from "@/lib/http/client";

// Type-only imports from `backend/`: they erase at compile time, so no server
// code reaches the browser bundle, and there stays one definition of each shape.
import type {
  AccessExplanationDTO,
  AnomalyDetailDTO,
  AnomalyListDTO,
  BillingHealthDTO,
  BillingTimelineDTO,
  BillingUserDTO,
  BulkResyncResultDTO,
  RawPayloadDTO,
} from "../backend/admin/admin-billing.dto";
import type { SubscriptionSyncDTO } from "../backend/admin-sync.service";
import type { AdminCancelResult } from "../backend/commands/admin-cancel";

const BASE_URL = "/api/v1/admin/billing";

export interface AnomalyListParams {
  readonly status?: "OPEN" | "RESOLVED" | "ALL";
  readonly type?: string;
  readonly userId?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface BulkResyncBody {
  readonly reason: string;
  /** ISO 8601. Only subscriptions last synced before it (or never). */
  readonly lastSyncedBefore?: string;
  readonly dryRun?: boolean;
}

const path = (value: string) => encodeURIComponent(value);

/**
 * The admin billing tools (Phase VIII). Thin: every rule, role check and
 * permission flag is the server's. "Sync now" and "immediate cancel" are the
 * Phase IV and VI endpoints, called here rather than rebuilt.
 */
export class BillingAdminApi {
  static async health(): Promise<BillingHealthDTO> {
    return (await HttpClient.get<BillingHealthDTO>(`${BASE_URL}/health`)).data;
  }

  static async lookupUser(query: { readonly userId: string } | { readonly email: string }): Promise<BillingUserDTO> {
    const search = new URLSearchParams("userId" in query ? { userId: query.userId } : { email: query.email });

    return (await HttpClient.get<BillingUserDTO>(`${BASE_URL}/users?${search.toString()}`)).data;
  }

  static async explain(userId: string): Promise<AccessExplanationDTO> {
    return (await HttpClient.get<AccessExplanationDTO>(`${BASE_URL}/users/${path(userId)}/access`)).data;
  }

  static async userTimeline(userId: string): Promise<BillingTimelineDTO> {
    return (await HttpClient.get<BillingTimelineDTO>(`${BASE_URL}/users/${path(userId)}/timeline`)).data;
  }

  static async subscriptionTimeline(subscriptionId: string): Promise<BillingTimelineDTO> {
    return (await HttpClient.get<BillingTimelineDTO>(`${BASE_URL}/subscriptions/${path(subscriptionId)}/timeline`)).data;
  }

  /** SUPER_ADMIN only; the server refuses everyone else. */
  static async rawPayload(billingEventId: string): Promise<RawPayloadDTO> {
    return (await HttpClient.get<RawPayloadDTO>(`${BASE_URL}/events/${path(billingEventId)}/payload`)).data;
  }

  static async listAnomalies(params: AnomalyListParams = {}): Promise<AnomalyListDTO> {
    const search = new URLSearchParams();

    if (params.status) search.set("status", params.status);
    if (params.type) search.set("type", params.type);
    if (params.userId) search.set("userId", params.userId);
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));

    const query = search.toString();

    return (await HttpClient.get<AnomalyListDTO>(query ? `${BASE_URL}/anomalies?${query}` : `${BASE_URL}/anomalies`)).data;
  }

  static async getAnomaly(id: string): Promise<AnomalyDetailDTO> {
    return (await HttpClient.get<AnomalyDetailDTO>(`${BASE_URL}/anomalies/${path(id)}`)).data;
  }

  static async resolveAnomaly(id: string, reason: string): Promise<AnomalyDetailDTO> {
    return (await HttpClient.post<AnomalyDetailDTO, { reason: string }>(`${BASE_URL}/anomalies/${path(id)}/resolve`, { reason }))
      .data;
  }

  /** Marks subscriptions due; never calls the provider. */
  static async bulkResync(body: BulkResyncBody): Promise<BulkResyncResultDTO> {
    return (await HttpClient.post<BulkResyncResultDTO, BulkResyncBody>(`${BASE_URL}/resync`, body)).data;
  }

  /** Phase IV "sync now" (VIEW_BILLING): one subscription, priority 1. */
  static async syncSubscription(subscriptionId: string): Promise<SubscriptionSyncDTO> {
    return (await HttpClient.post<SubscriptionSyncDTO>(`${BASE_URL}/subscriptions/${path(subscriptionId)}/sync`)).data;
  }

  /** Phase VI admin immediate cancel (MANAGE_BILLING): a reason, and one `Idempotency-Key` per click. */
  static async cancelSubscription(subscriptionId: string, reason: string, idempotencyKey: string): Promise<AdminCancelResult> {
    return (
      await HttpClient.post<AdminCancelResult, { reason: string }>(
        `${BASE_URL}/subscriptions/${path(subscriptionId)}/cancel`,
        { reason },
        { headers: { "Idempotency-Key": idempotencyKey } },
      )
    ).data;
  }
}
