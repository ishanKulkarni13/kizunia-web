import { z } from "zod";

/**
 * A grant records why it exists (SB-EA-08: "a mandatory reason"). Every
 * create, extend and revoke carries one, and it lands in the audit entry.
 */
const Reason = z.string().trim().min(3).max(500);

/**
 * An e-mail address, trimmed and lower-cased *before* it is validated — in zod 4
 * `z.email()` checks the raw input, so a pasted address with a stray space would
 * otherwise be rejected as invalid.
 */
const EmailAddress = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email().max(320),
);

/** Paid plans only — FREE is not a grant, it is the absence of one. */
export const GrantPlanSchema = z.enum(["PRO", "PRO_PLUS"]);

/** Ten years. A longer grant is better expressed as "no expiry". */
export const MAX_GRANT_DURATION_DAYS = 3650;

export const CreateGrantSchema = z
  .object({
    /** The recipient, by user id or by e-mail — exactly one of the two. */
    userId: z.string().trim().min(1).max(191).optional(),
    email: EmailAddress.optional(),
    plan: GrantPlanSchema,
    /**
     * Whole days from now, or `null` for no expiry. Required (not optional)
     * so an indefinite grant is always a deliberate choice, never an omission.
     */
    durationDays: z.number().int().min(1).max(MAX_GRANT_DURATION_DAYS).nullable(),
    reason: Reason,
  })
  .strict()
  .refine((input) => (input.userId === undefined) !== (input.email === undefined), {
    message: "Specify the recipient by exactly one of userId or email.",
    path: ["userId"],
  });

export type CreateGrantInput = z.infer<typeof CreateGrantSchema>;

export const ExtendGrantSchema = z
  .object({
    /**
     * The new end of the grant (ISO 8601 with an offset), or `null` for no
     * expiry. It must lengthen the grant; shortening is done by revoking.
     */
    validUntil: z
      .union([z.iso.datetime({ offset: true }), z.null()])
      .transform((value) => (value === null ? null : new Date(value))),
    reason: Reason,
  })
  .strict();

export type ExtendGrantInput = z.infer<typeof ExtendGrantSchema>;

export const RevokeGrantSchema = z
  .object({
    reason: Reason,
  })
  .strict();

export type RevokeGrantInput = z.infer<typeof RevokeGrantSchema>;

/**
 * Filters for the admin grant list. `page` and `limit` are deliberately absent:
 * they go through `parsePagination`, which clamps rather than rejects, the same
 * as every other list in the repository.
 */
export const GrantListFilterSchema = z.object({
  userId: z.string().trim().min(1).max(191).optional(),
  email: EmailAddress.optional(),
  status: z.enum(["ACTIVE", "REVOKED"]).optional(),
});

export type GrantListFilter = z.infer<typeof GrantListFilterSchema>;
