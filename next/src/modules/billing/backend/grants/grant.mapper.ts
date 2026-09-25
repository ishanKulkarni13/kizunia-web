/**
 * Billing — Entitlement Grant Mapper
 *
 * Database rows → DTOs. Prisma models never leave the backend.
 */
import { grantStateAt } from "@/lib/entitlements/validity";

import type { GrantActorDTO, GrantAuditEntryDTO, GrantDTO } from "./grant.dto";
import type { GrantWithRelations } from "./grant.repository";

function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

function actor(id: string | null, names: ReadonlyMap<string, string>): GrantActorDTO | null {
  return id === null ? null : { id, name: names.get(id) ?? null };
}

/** Every actor id a set of grants refers to, for one name lookup. */
export function actorIdsOf(grants: readonly GrantWithRelations[]): string[] {
  const ids: string[] = [];

  for (const grant of grants) {
    if (grant.grantedByUserId) ids.push(grant.grantedByUserId);
    if (grant.revokedByUserId) ids.push(grant.revokedByUserId);
    for (const entry of grant.auditEntries) ids.push(entry.performedByUserId);
  }

  return ids;
}

export function toGrantDTO(
  grant: GrantWithRelations,
  names: ReadonlyMap<string, string>,
  now: Date,
): GrantDTO {
  const auditTrail: GrantAuditEntryDTO[] = grant.auditEntries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    performedBy: { id: entry.performedByUserId, name: names.get(entry.performedByUserId) ?? null },
    previousValidUntil: iso(entry.previousValidUntil),
    newValidUntil: iso(entry.newValidUntil),
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
  }));

  return {
    id: grant.id,
    plan: grant.plan,
    source: grant.source,
    status: grant.status,
    state: grantStateAt(grant, now),
    evaluatedAt: now.toISOString(),
    validFrom: grant.validFrom.toISOString(),
    validUntil: iso(grant.validUntil),
    reason: grant.reason,
    recipient: grant.user,
    grantedBy: actor(grant.grantedByUserId, names),
    revokedAt: iso(grant.revokedAt),
    revokedBy: actor(grant.revokedByUserId, names),
    revokeReason: grant.revokeReason,
    createdAt: grant.createdAt.toISOString(),
    auditTrail,
  };
}
