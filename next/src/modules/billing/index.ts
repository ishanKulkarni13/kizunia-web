/**
 * Billing module — public API. Import from this file, not from `backend/`,
 * outside this module.
 *
 * `backend/` is NOT re-exported here: it reaches `@/lib/prisma` and
 * `next/server`, and this barrel must stay safe to import from a client
 * component. Server-side consumers (route handlers, pages) deep-import
 * `@/modules/billing/backend/...` directly — the convention
 * `modules/notifications` establishes.
 *
 * Feature modules must NOT import billing at all: they ask
 * `@/lib/entitlements` for capabilities and quotas. Billing never reaches into
 * feature modules either (docs/architecture/subscription/module-boundaries.md).
 */

export type {
  GrantActorDTO,
  GrantAuditEntryDTO,
  GrantDTO,
  GrantListDTO,
  GrantPlanDTO,
  GrantUserDTO,
} from "./backend/grants/grant.dto";
export type { MyEntitlementsDTO } from "./backend/entitlements.service";
export { BillingErrorCode } from "./errors/error-code";
