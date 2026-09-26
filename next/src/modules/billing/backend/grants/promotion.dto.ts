/**
 * Billing — Promotion DTOs
 *
 * Response shapes for the admin promotion API and the redemption answer.
 * Dates are ISO strings. `state` is derived at read time and never stored,
 * like a grant's (SB-EA-09). Type-only: safe to `import type` from client code.
 */
import type { PaginationMeta } from "@/lib/search/types";

import type { GrantActorDTO, GrantPlanDTO } from "./grant.dto";

export type PromotionEligibilityDTO = "ANY_USER" | "FIRST_PAID_SUBSCRIPTION_ONLY" | "ONCE_PER_USER";

/** Derived at `evaluatedAt`. */
export type PromotionState = "SCHEDULED" | "ACTIVE" | "EXPIRED" | "SOLD_OUT";

export interface PromotionDTO {
  readonly id: string;
  readonly code: string;
  readonly plan: GrantPlanDTO;
  readonly durationDays: number;
  /** `null` = unlimited. */
  readonly remainingRedemptions: number | null;
  readonly redemptionCount: number;
  readonly eligibility: PromotionEligibilityDTO;
  readonly validFrom: string;
  /** `null` = never expires. */
  readonly validUntil: string | null;
  readonly state: PromotionState;
  readonly evaluatedAt: string;
  readonly createdBy: GrantActorDTO;
  readonly createdAt: string;
}

export interface PromotionListDTO {
  readonly items: readonly PromotionDTO[];
  readonly pagination: PaginationMeta;
}

/** What a user sees after redeeming: the access they now have, from the grant. */
export interface RedeemedPromotionDTO {
  readonly code: string;
  readonly plan: GrantPlanDTO;
  readonly validFrom: string;
  readonly validUntil: string;
}
