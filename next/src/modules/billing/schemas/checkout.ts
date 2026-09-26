import { z } from "zod";

/** A Kizunia record ID (cuid) as the browser echoes it back; never a provider ID. */
export const KizuniaIdSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9]+$/);

/** What a customer types: letters, digits, `-` and `_`. Normalized (trimmed, upper-case) on the server. */
export const MarketingCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "A code has only letters, digits, '-' and '_'.");

/**
 * `POST /api/v1/me/billing/checkout`. A plan and a cycle: the user is the
 * session user, never a body field. Phase VII adds exactly two optional
 * intents, a `trial` flag and a marketing `code`. Everything else that decides
 * a checkout (the price, a discount, the plan a code applies to, trial
 * eligibility, the Offer's provider identifier, the trial's start time) is
 * resolved on the server from Kizunia's own records, so `.strict()` refuses
 * any such field instead of silently ignoring it. A code with a trial is a
 * typed refusal from the precondition policy (IB-27 item 3), not a schema rule,
 * so the rule lives in one place.
 *
 * Supersession (Phase VI, IB-26 item 5): `supersedesSubscriptionId` names the
 * on-hold subscription (from `/me/billing`) the customer agreed to cancel
 * permanently, and `confirmSupersession: true` is that agreement. Neither is
 * accepted without the other.
 */
export const StartCheckoutSchema = z
  .object({
    plan: z.enum(["PRO", "PRO_PLUS"]),
    cycle: z.enum(["MONTHLY", "YEARLY"]),
    trial: z.boolean().optional(),
    code: MarketingCodeSchema.optional(),
    supersedesSubscriptionId: KizuniaIdSchema.optional(),
    confirmSupersession: z.literal(true).optional(),
  })
  .strict()
  .refine((input) => (input.supersedesSubscriptionId === undefined) === (input.confirmSupersession === undefined), {
    message: "Replacing an on-hold subscription needs both supersedesSubscriptionId and confirmSupersession: true.",
    path: ["confirmSupersession"],
  });

export type StartCheckoutInput = z.infer<typeof StartCheckoutSchema>;

/**
 * The normalized intent stored on a `CREATE_SUBSCRIPTION` operation's
 * `request` (never a provider payload). `kind` distinguishes a trial create
 * from a standard one, and `code` is the normalized marketing code, so a replay
 * of a recorded refusal explains itself from what was asked, not from what the
 * replaying body says (IB-27 item 11).
 */
export const CreateSubscriptionRequestSchema = z.object({
  plan: z.enum(["PRO", "PRO_PLUS"]),
  cycle: z.enum(["MONTHLY", "YEARLY"]),
  kind: z.enum(["STANDARD", "TRIAL"]),
  code: z.string().optional(),
});

export type CreateSubscriptionRequest = z.infer<typeof CreateSubscriptionRequestSchema>;

/**
 * `POST /api/v1/me/billing/checkout/confirm`: what Razorpay Checkout's
 * handler receives. The subscription ID is optional and is **never** used to
 * verify the signature or to pick a subscription (SB-CM-06): the server uses
 * the ID it holds for the caller's own pending checkout.
 */
const RazorpayId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_]+$/);

export const ConfirmCheckoutSchema = z
  .object({
    razorpayPaymentId: RazorpayId,
    razorpaySignature: z.string().trim().min(1).max(256),
    razorpaySubscriptionId: RazorpayId.optional(),
  })
  .strict();

export type ConfirmCheckoutInput = z.infer<typeof ConfirmCheckoutSchema>;
