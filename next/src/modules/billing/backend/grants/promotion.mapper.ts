/**
 * Billing — Promotion Mapper
 *
 * Database rows → DTOs. Prisma models never leave the backend.
 */
import type { Promotion } from "@/generated/prisma";

import type { PromotionDTO, PromotionState } from "./promotion.dto";
import type { PromotionWithCount } from "./promotion.repository";

/** Derived at `now`; never stored, like a grant's state (SB-EA-09). */
export function promotionStateAt(promotion: Pick<Promotion, "validFrom" | "validUntil" | "remainingRedemptions">, now: Date): PromotionState {
  if (now.getTime() < promotion.validFrom.getTime()) return "SCHEDULED";
  if (promotion.validUntil !== null && now.getTime() >= promotion.validUntil.getTime()) return "EXPIRED";
  if (promotion.remainingRedemptions === 0) return "SOLD_OUT";

  return "ACTIVE";
}

export function toPromotionDTO(promotion: PromotionWithCount, names: ReadonlyMap<string, string>, now: Date): PromotionDTO {
  return {
    id: promotion.id,
    code: promotion.code,
    plan: promotion.plan,
    durationDays: promotion.durationDays,
    remainingRedemptions: promotion.remainingRedemptions,
    redemptionCount: promotion._count.redemptions,
    eligibility: promotion.eligibility,
    validFrom: promotion.validFrom.toISOString(),
    validUntil: promotion.validUntil?.toISOString() ?? null,
    state: promotionStateAt(promotion, now),
    evaluatedAt: now.toISOString(),
    createdBy: { id: promotion.createdByUserId, name: names.get(promotion.createdByUserId) ?? null },
    createdAt: promotion.createdAt.toISOString(),
  };
}
