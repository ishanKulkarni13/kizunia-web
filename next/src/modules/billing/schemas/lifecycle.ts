import { z } from "zod";

/**
 * `POST /api/v1/me/billing/cancel`. The customer confirms the timing they were
 * shown ("ends on <date>" is `CYCLE_END`; "ends now" is `IMMEDIATE`), and the
 * server refuses the request if that is no longer the timing that applies
 * (IB-26 item 2). Which subscription is the session user's single open one:
 * never a body field.
 */
export const CancelSubscriptionSchema = z
  .object({
    timing: z.enum(["CYCLE_END", "IMMEDIATE"]),
  })
  .strict();

export type CancelSubscriptionInput = z.infer<typeof CancelSubscriptionSchema>;

/** `POST /api/v1/me/billing/change-plan`: the plan and cycle to move to. */
export const ChangePlanSchema = z
  .object({
    plan: z.enum(["PRO", "PRO_PLUS"]),
    cycle: z.enum(["MONTHLY", "YEARLY"]),
  })
  .strict();

export type ChangePlanInput = z.infer<typeof ChangePlanSchema>;

/**
 * `POST /api/v1/admin/billing/subscriptions/{id}/cancel`. An immediate cancel
 * needs a reason (SB-LC-05), recorded on the operation.
 */
export const AdminCancelSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type AdminCancelInput = z.infer<typeof AdminCancelSchema>;

/**
 * The normalized intent stored on a cancel operation's `request` (never a
 * provider payload). A cycle-end cancel's shape is `CancelAtCycleEndRequestSchema`
 * (policy/operation-settlement.ts), because the apply path reads it.
 */
export const CancelImmediatelyRequestSchema = z.object({
  atCycleEnd: z.literal(false),
  reason: z.enum(["CUSTOMER_CANCEL", "ABANDON_CHECKOUT", "ADMIN_CANCEL", "SUPERSESSION"]),
  note: z.string().optional(),
});

export type CancelImmediatelyRequest = z.infer<typeof CancelImmediatelyRequestSchema>;
