import { z } from "zod";

/**
 * Inbox query parameters.
 *
 * `limit` is bounded here as well as in the service. Two bounds for one rule is
 * usually a smell, but these answer different questions: this one rejects a
 * nonsensical request with a clear message, the service's clamps whatever
 * reaches it from any caller.
 */
export const ListNotificationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).max(64).optional(),
    unreadOnly: z
      .union([z.literal("true"), z.literal("false")])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

/**
 * Registering a browser for push.
 *
 * Note the absence of a `userId`. The authenticated session is the only source
 * of identity for a self-scoped operation, and accepting one from the client
 * would make "register a device for someone else" expressible — which is
 * exactly the request this schema should not be able to represent.
 */
export const RegisterPushSubscriptionSchema = z
  .object({
    /**
     * An FCM registration token. Length-bounded rather than pattern-matched:
     * the format is the provider's to change, and a regex here would start
     * rejecting valid tokens the day they lengthen it.
     */
    token: z.string().min(16).max(4096),
    userAgent: z.string().max(512).optional(),
  })
  .strict();

export type RegisterPushSubscriptionInput = z.infer<
  typeof RegisterPushSubscriptionSchema
>;

export const RevokePushSubscriptionSchema = z
  .object({
    token: z.string().min(16).max(4096),
  })
  .strict();
