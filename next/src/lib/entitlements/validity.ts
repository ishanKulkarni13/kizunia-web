/**
 * Entitlements — Grant Validity
 *
 * When a grant contributes, as a pure function. This is the in-memory twin of
 * `validGrantWhere` (grant-predicate.ts); an integration test holds the two
 * to the same answers on shared fixtures.
 *
 * "Expired" is derived here, at read time, and never written (SB-EA-09):
 * there is no expiry job, and resolving access never touches the database.
 *
 * Pure — safe to import from client components.
 */

export type GrantStatusValue = "ACTIVE" | "REVOKED";

export interface GrantWindow {
  readonly status: GrantStatusValue;
  readonly validFrom: Date;
  /** `null` = no expiry. */
  readonly validUntil: Date | null;
}

/**
 * A grant's state at an instant:
 * - `ACTIVE` — contributes now
 * - `SCHEDULED` — not yet started (`now < validFrom`)
 * - `EXPIRED` — its window has ended (`now >= validUntil`)
 * - `REVOKED` — revoked, whatever its window says
 */
export type GrantState = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "REVOKED";

export function grantStateAt(grant: GrantWindow, now: Date): GrantState {
  if (grant.status === "REVOKED") return "REVOKED";
  if (now.getTime() < grant.validFrom.getTime()) return "SCHEDULED";
  if (grant.validUntil !== null && now.getTime() >= grant.validUntil.getTime()) {
    return "EXPIRED";
  }
  return "ACTIVE";
}

/** `status = ACTIVE` and `validFrom <= now < validUntil` (open-ended when `validUntil` is null). */
export function isGrantContributing(grant: GrantWindow, now: Date): boolean {
  return grantStateAt(grant, now) === "ACTIVE";
}
