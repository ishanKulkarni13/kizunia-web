import { z } from "zod";

/** A Kizunia record ID (cuid) as the browser echoes it back; never a provider ID. */
export const KizuniaIdSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9]+$/);

/**
 * `POST /api/v1/me/billing/checkout`. A plan and a cycle: the user is the
 * session user, never a body field, and trials (`kind`) and marketing codes
 * (`code`) arrive with Phase VII, so `.strict()` refuses them rather than
 * silently ignoring an intent Kizunia cannot honor yet.
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
 * `request` (never a provider payload). `kind` is stamped so a Phase VII trial
 * create is distinguishable from a standard one.
 */
export const CreateSubscriptionRequestSchema = z.object({
  plan: z.enum(["PRO", "PRO_PLUS"]),
  cycle: z.enum(["MONTHLY", "YEARLY"]),
  kind: z.enum(["STANDARD", "TRIAL"]),
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
