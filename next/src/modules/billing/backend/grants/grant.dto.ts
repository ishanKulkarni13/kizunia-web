/**
 * Billing — Entitlement Grant DTOs
 *
 * Response shapes for the admin grant API. Dates are ISO strings. `state` is
 * derived at read time and never stored (SB-EA-09). The UI renders these as
 * given and never computes access or permissions itself.
 *
 * Type-only: safe to `import type` from client code.
 */
import type { PaginationMeta } from "@/lib/search/types";
import type { GrantState } from "@/lib/entitlements/validity";

export type GrantPlanDTO = "PRO" | "PRO_PLUS";

export interface GrantUserDTO {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly username: string | null;
}

export interface GrantActorDTO {
  readonly id: string;
  /** `null` when the actor's account no longer exists; the id is kept. */
  readonly name: string | null;
}

export interface GrantAuditEntryDTO {
  readonly id: string;
  readonly action: "CREATED" | "EXTENDED" | "REVOKED";
  readonly performedBy: GrantActorDTO;
  readonly previousValidUntil: string | null;
  readonly newValidUntil: string | null;
  readonly reason: string;
  readonly createdAt: string;
}

export interface GrantDTO {
  readonly id: string;
  readonly plan: GrantPlanDTO;
  readonly source: "ADMIN_GRANT" | "PROMOTION";
  readonly status: "ACTIVE" | "REVOKED";
  /** Derived at `evaluatedAt`: ACTIVE, SCHEDULED, EXPIRED or REVOKED. */
  readonly state: GrantState;
  readonly evaluatedAt: string;
  readonly validFrom: string;
  /** `null` = no expiry. */
  readonly validUntil: string | null;
  readonly reason: string;
  /** `null` once the recipient's billing records have been pseudonymized. */
  readonly recipient: GrantUserDTO | null;
  readonly grantedBy: GrantActorDTO | null;
  readonly revokedAt: string | null;
  readonly revokedBy: GrantActorDTO | null;
  readonly revokeReason: string | null;
  readonly createdAt: string;
  readonly auditTrail: readonly GrantAuditEntryDTO[];
}

export interface GrantListDTO {
  readonly items: readonly GrantDTO[];
  readonly pagination: PaginationMeta;
  /** Server-computed: whether the viewer may create, extend and revoke. */
  readonly permissions: { readonly canManage: boolean };
}
