import { z } from "zod";

import { BillingAnomalyType } from "@/generated/prisma";

/**
 * Admin billing tools (Phase VIII). Every recorded admin action carries a
 * reason, as grants and the admin cancel do: the same 3–500 character rule.
 */
const Reason = z.string().trim().min(3).max(500);

/** Trimmed and lower-cased before validation, as for grant recipients (zod 4 checks the raw input). */
const EmailAddress = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email().max(320),
);

/** Look a user up by id or by e-mail address — exactly one of the two. */
export const UserLookupSchema = z
  .object({
    userId: z.string().trim().min(1).max(191).optional(),
    email: EmailAddress.optional(),
  })
  .strict()
  .refine((input) => (input.userId === undefined) !== (input.email === undefined), {
    message: "Specify the user by exactly one of userId or email.",
    path: ["userId"],
  });

export type UserLookupInput = z.infer<typeof UserLookupSchema>;

/** Resolving an anomaly records a human decision; the reason is mandatory. */
export const ResolveAnomalySchema = z.object({ reason: Reason }).strict();

export type ResolveAnomalyInput = z.infer<typeof ResolveAnomalySchema>;

/**
 * Bulk re-sync (IB-28 item 3): mark matching subscriptions due. Optionally only
 * those whose last sync predates `lastSyncedBefore` (the runbook's "since the
 * incident started"). `dryRun` counts the matches and writes nothing.
 */
export const BulkResyncSchema = z
  .object({
    reason: Reason,
    lastSyncedBefore: z.iso.datetime({ offset: true }).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export type BulkResyncInput = z.infer<typeof BulkResyncSchema>;

export const AnomalyStatusFilter = z.enum(["OPEN", "RESOLVED", "ALL"]);

export type AnomalyStatusFilter = z.infer<typeof AnomalyStatusFilter>;

/** Query-string filters for the anomaly list. Pagination is parsed separately. */
export const AnomalyListFilterSchema = z.object({
  status: AnomalyStatusFilter.default("OPEN"),
  type: z.enum(BillingAnomalyType).optional(),
  userId: z.string().trim().min(1).max(191).optional(),
});

export type AnomalyListFilter = z.infer<typeof AnomalyListFilterSchema>;
