/**
 * Billing — Entitlement Grants
 *
 * Business Layer
 *
 * Responsibilities
 * ----------------
 * ✓ Authorize, then list, create, extend and revoke admin grants
 * ✓ Write every change and its audit entry in one transaction
 *
 * Does NOT
 * ----------------
 * ✗ Expire grants. Expiry is derived when access is read (SB-EA-09); nothing
 *   is written when a grant's window ends, and there is no job
 * ✗ Touch any payment provider. Grants work with Razorpay never configured
 * ✗ Parse requests or read sessions
 *
 * ## Why authorization re-reads the actor
 *
 * A grant is money-equivalent. Every call resolves the actor's role and ban
 * state from the database (`PlatformContextResolver`) instead of trusting the
 * session's copy, so a demotion or a ban takes effect immediately.
 *
 * ## Concurrency
 *
 * Extend and revoke lock the grant row first (`GrantRepository.lockById`) and
 * decide from what they read under the lock. Two concurrent mutations
 * therefore serialize: each successful one is audited, and an extension can
 * never land on — or resurrect — a grant another request has just revoked.
 *
 * See docs/architecture/subscription/entitlements/admin-grants.md.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import prisma from "@/lib/prisma";
import { buildPaginationMeta, parsePagination, toSkipTake } from "@/lib/search/pagination";
import type { RawSearchParams } from "@/lib/search/types";

import {
  GrantExtensionInvalidError,
  GrantNotFoundError,
  GrantRecipientNotFoundError,
  GrantRevokedError,
  SelfGrantForbiddenError,
} from "../../errors";
import { logBillingEvent } from "../../observability/log";
import {
  GrantListFilterSchema,
  type CreateGrantInput,
  type ExtendGrantInput,
  type RevokeGrantInput,
} from "../../schemas/grant";
import { BillingAuthorizer } from "../authorization/authorizer";
import type { GrantDTO, GrantListDTO } from "./grant.dto";
import { actorIdsOf, toGrantDTO } from "./grant.mapper";
import { GrantRepository, type GrantWithRelations } from "./grant.repository";

const DAY_MS = 24 * 60 * 60 * 1000;

const LIST_PAGINATION = { defaultLimit: 25, maxLimit: 100 } as const;

async function toDTOs(
  repository: GrantRepository,
  grants: readonly GrantWithRelations[],
  now: Date,
): Promise<GrantDTO[]> {
  const names = await repository.findUserNames(actorIdsOf(grants));

  return grants.map((grant) => toGrantDTO(grant, names, now));
}

async function loadDTO(grantId: string, now: Date): Promise<GrantDTO> {
  const repository = new GrantRepository();
  const grant = await repository.findByIdWithRelations(grantId);

  if (!grant) throw new GrantNotFoundError();

  const [dto] = await toDTOs(repository, [grant], now);
  return dto;
}

export class GrantService {
  static async list(actor: StrictAuthorizationActor, params: RawSearchParams): Promise<GrantListDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.viewBilling(context);

    const filter = GrantListFilterSchema.parse({
      userId: params.userId,
      email: params.email,
      status: params.status,
    });
    const pagination = parsePagination(params, LIST_PAGINATION);
    const repository = new GrantRepository();
    const where = GrantRepository.buildWhere(filter);
    const now = new Date();

    const [grants, total] = await Promise.all([
      repository.findMany(where, toSkipTake(pagination)),
      repository.count(where),
    ]);

    return {
      items: await toDTOs(repository, grants, now),
      pagination: buildPaginationMeta(pagination, total),
      permissions: { canManage: BillingAuthorizer.canManageGrants(context) },
    };
  }

  static async create(actor: StrictAuthorizationActor, input: CreateGrantInput): Promise<GrantDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.manageGrants(context);
    const actorId = actor.id;

    const recipient = await new GrantRepository().findRecipient(
      input.userId !== undefined ? { userId: input.userId } : { email: input.email as string },
    );

    if (!recipient) throw new GrantRecipientNotFoundError();
    // SB-EA-08 — also a CHECK constraint on the table.
    if (recipient.id === actorId) throw new SelfGrantForbiddenError();

    const now = new Date();
    const validUntil =
      input.durationDays === null ? null : new Date(now.getTime() + input.durationDays * DAY_MS);

    const grant = await prisma.$transaction(async (tx) => {
      const repository = new GrantRepository(tx);
      const created = await repository.create({
        userId: recipient.id,
        plan: input.plan,
        validFrom: now,
        validUntil,
        grantedByUserId: actorId,
        reason: input.reason,
      });

      await repository.createAudit({
        grantId: created.id,
        action: "CREATED",
        performedByUserId: actorId,
        targetUserId: recipient.id,
        plan: created.plan,
        previousValidUntil: null,
        newValidUntil: validUntil,
        reason: input.reason,
      });

      return created;
    });

    logBillingEvent("grant.created", {
      grantId: grant.id,
      actorId,
      targetUserId: recipient.id,
      plan: grant.plan,
      validFrom: grant.validFrom.toISOString(),
      validUntil: grant.validUntil?.toISOString() ?? null,
      reason: input.reason,
    });

    return loadDTO(grant.id, now);
  }

  /**
   * Moves a grant's end of validity later — or to "no expiry". An expired (but
   * not revoked) grant may be extended; it contributes again from the moment
   * the extension commits. Shortening is not an extension: revoke instead.
   */
  static async extend(
    actor: StrictAuthorizationActor,
    grantId: string,
    input: ExtendGrantInput,
  ): Promise<GrantDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.manageGrants(context);
    const actorId = actor.id;

    const result = await prisma.$transaction(async (tx) => {
      const repository = new GrantRepository(tx);
      const grant = await repository.lockById(grantId);
      const now = new Date();

      if (!grant) throw new GrantNotFoundError();
      // SB-EA-08 covers extending as well as creating.
      if (grant.userId !== null && grant.userId === actorId) throw new SelfGrantForbiddenError();
      if (grant.status === "REVOKED") throw new GrantRevokedError();

      const current = grant.validUntil;
      const next = input.validUntil;

      if (current === null) {
        throw new GrantExtensionInvalidError("This grant already has no expiry.");
      }
      if (next !== null) {
        if (next.getTime() <= current.getTime()) {
          throw new GrantExtensionInvalidError(
            "An extension must end later than the grant currently does. To shorten a grant, revoke it.",
          );
        }
        if (next.getTime() <= now.getTime()) {
          throw new GrantExtensionInvalidError("An extension must end in the future.");
        }
      }

      // The row lock makes this unconditional in practice; the status
      // condition inside is belt and braces.
      const changed = await repository.updateValidUntil(grant.id, next);
      if (changed !== 1) throw new GrantRevokedError();

      await repository.createAudit({
        grantId: grant.id,
        action: "EXTENDED",
        performedByUserId: actorId,
        targetUserId: grant.userId,
        plan: grant.plan,
        previousValidUntil: current,
        newValidUntil: next,
        reason: input.reason,
      });

      return { grant, previous: current, next, now };
    });

    logBillingEvent("grant.extended", {
      grantId: result.grant.id,
      actorId,
      targetUserId: result.grant.userId,
      plan: result.grant.plan,
      previousValidUntil: result.previous.toISOString(),
      validUntil: result.next?.toISOString() ?? null,
      reason: input.reason,
    });

    return loadDTO(result.grant.id, result.now);
  }

  /**
   * Revokes a grant. Final: a revoked grant is never extended or revoked again.
   * Revoking only reduces access, so SB-EA-08 does not apply — an administrator
   * may revoke a grant made to themselves.
   */
  static async revoke(
    actor: StrictAuthorizationActor,
    grantId: string,
    input: RevokeGrantInput,
  ): Promise<GrantDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.manageGrants(context);
    const actorId = actor.id;

    const result = await prisma.$transaction(async (tx) => {
      const repository = new GrantRepository(tx);
      const grant = await repository.lockById(grantId);
      const now = new Date();

      if (!grant) throw new GrantNotFoundError();
      if (grant.status === "REVOKED") throw new GrantRevokedError();

      const changed = await repository.revoke(grant.id, {
        revokedAt: now,
        revokedByUserId: actorId,
        revokeReason: input.reason,
      });
      if (changed !== 1) throw new GrantRevokedError();

      await repository.createAudit({
        grantId: grant.id,
        action: "REVOKED",
        performedByUserId: actorId,
        targetUserId: grant.userId,
        plan: grant.plan,
        previousValidUntil: grant.validUntil,
        newValidUntil: null,
        reason: input.reason,
      });

      return { grant, now };
    });

    logBillingEvent("grant.revoked", {
      grantId: result.grant.id,
      actorId,
      targetUserId: result.grant.userId,
      plan: result.grant.plan,
      reason: input.reason,
    });

    return loadDTO(result.grant.id, result.now);
  }
}
