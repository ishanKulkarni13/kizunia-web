import { z } from "zod";

import { GrantPlanSchema, MAX_GRANT_DURATION_DAYS } from "./grant";
import { MarketingCodeSchema } from "./checkout";

/** The rules of SB-CP-04, the same three an Offer code can carry. */
export const CodeEligibilitySchema = z.enum(["ANY_USER", "FIRST_PAID_SUBSCRIPTION_ONLY", "ONCE_PER_USER"]);

/** No campaign is meant to be larger than this; a cap, not a target. */
export const MAX_PROMOTION_REDEMPTIONS = 1_000_000;

/**
 * `POST /api/v1/admin/billing/promotions`. A Promotion is free plan-level access
 * for a period, redeemed with a code (SB-CP-01). Like a grant, the limits are
 * deliberate choices rather than omissions: `maxRedemptions` and `validUntil`
 * are required, with `null` meaning "no limit".
 */
export const CreatePromotionSchema = z
  .object({
    code: MarketingCodeSchema,
    plan: GrantPlanSchema,
    /** Whole days of access from the moment of redemption. */
    durationDays: z.number().int().min(1).max(MAX_GRANT_DURATION_DAYS),
    /** How many users may redeem it in total, or `null` for no limit. */
    maxRedemptions: z.number().int().min(1).max(MAX_PROMOTION_REDEMPTIONS).nullable(),
    /** When the code becomes redeemable (ISO 8601 with an offset); defaults to now. */
    validFrom: z
      .iso.datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
    /** When it stops being redeemable, or `null` for never. */
    validUntil: z.union([z.iso.datetime({ offset: true }), z.null()]).transform((value) => (value === null ? null : new Date(value))),
    eligibility: CodeEligibilitySchema.default("ANY_USER"),
  })
  .strict()
  .refine((input) => input.validUntil === null || input.validFrom === undefined || input.validUntil.getTime() > input.validFrom.getTime(), {
    message: "validUntil must be after validFrom.",
    path: ["validUntil"],
  });

export type CreatePromotionInput = z.infer<typeof CreatePromotionSchema>;

/**
 * `POST /api/v1/me/billing/promotions/redeem`. Only the code: the redeemer is
 * the session user, and the plan, duration and eligibility all come from the
 * server's own record of the promotion, never from the request.
 */
export const RedeemPromotionSchema = z.object({ code: MarketingCodeSchema }).strict();

export type RedeemPromotionInput = z.infer<typeof RedeemPromotionSchema>;
