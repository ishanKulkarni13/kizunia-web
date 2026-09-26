/**
 * Billing — Promotions
 *
 * Business Layer
 *
 * A Promotion is free plan-level access for a period, redeemed with a code
 * (SB-CP-01, docs/architecture/subscription/entitlements/coupons-and-offers.md).
 * It is a Kizunia-only record: redemption creates an ordinary entitlement grant
 * (`source = PROMOTION`), so it flows through the same resolver and is audited
 * like an admin grant. No Razorpay call happens anywhere in this file, so it
 * works in every provider mode, including `disabled`.
 *
 * Responsibilities
 * ----------------
 * ✓ Authorize, then create and list promotions (admin)
 * ✓ Redeem a promotion for the session user, atomically
 *
 * Does NOT
 * ----------------
 * ✗ Touch any payment provider, or a Razorpay Offer. A promotion never
 *   references one; an Offer code is a different concept (SB-CP-01)
 * ✗ Trust anything the client says about the promotion: the plan, duration,
 *   window and eligibility are all read from the promotion's own record
 * ✗ Expire anything. The grant's validity is derived when access is read
 *
 * ## Authorization: one chain (IB-27 item 16)
 *
 * `MANAGE_ENTITLEMENT_GRANTS` (`SUPER_ADMIN` only, IB-15) is the single
 * authoritative permission for creating **and** listing promotions, enforced
 * here through `BillingAuthorizer.manageGrants`, so no caller can go around the
 * HTTP layer. The admin rate-limit policies throttle and authorize nothing.
 * Redeeming needs only an authenticated session; the redeemer is always the
 * session user, never a request field.
 *
 * ## Redemption is one transaction (IB-27 item 15)
 *
 * The conditional decrement of the remaining-redemptions counter, the grant,
 * the redemption record and the audit entry commit together or not at all. A
 * duplicate (the unique `(promotionId, userId)` record), a sold-out promotion, an
 * ineligible user, an expired code, or any error rolls all of it back: no
 * grant, no redemption, no counter change, no audit row. Logs are emitted only
 * after the commit.
 *
 * Both guards are needed. The unique record stops one user redeeming twice from
 * two tabs; the conditional decrement (`WHERE remainingRedemptions > 0`) stops
 * two users taking the last slot. The database is the source of truth for both.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import { Prisma, type ProviderMode } from "@/generated/prisma";
import { expectedBillingMode } from "@/lib/entitlements/billing-mode";
import prisma from "@/lib/prisma";
import { buildPaginationMeta, parsePagination, toSkipTake } from "@/lib/search/pagination";
import type { RawSearchParams } from "@/lib/search/types";

import {
  PromotionAlreadyRedeemedError,
  PromotionCodeInvalidError,
  PromotionCodeTakenError,
  PromotionNotEligibleError,
  PromotionSoldOutError,
  PromotionWindowInvalidError,
} from "../../errors";
import { logBillingEvent } from "../../observability/log";
import { isWithinWindow, NO_BILLING_HISTORY, normalizeCode, satisfiesEligibility } from "../../policy/code-eligibility";
import type { CreatePromotionInput, RedeemPromotionInput } from "../../schemas/promotion";
import { BillingAuthorizer } from "../authorization/authorizer";
import { loadBillingHistory } from "../commands/billing-history";
import { getOfferCodeSource, type OfferCodeSource } from "../offers/offer-code-source";
import { GrantRepository } from "./grant.repository";
import type { PromotionDTO, PromotionListDTO, RedeemedPromotionDTO } from "./promotion.dto";
import { toPromotionDTO } from "./promotion.mapper";
import { PromotionRepository } from "./promotion.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_PAGINATION = { defaultLimit: 25, maxLimit: 100 } as const;

export interface PromotionDeps {
  readonly now?: () => Date;
  /** The provider mode eligibility history is read in (default: the deployment's expected mode). */
  readonly mode?: () => ProviderMode;
  readonly offers?: OfferCodeSource;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export class PromotionService {
  // -- Admin ----------------------------------------------------------------

  static async list(actor: StrictAuthorizationActor, params: RawSearchParams, deps: PromotionDeps = {}): Promise<PromotionListDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.manageGrants(context);

    const pagination = parsePagination(params, LIST_PAGINATION);
    const repository = new PromotionRepository();
    const now = (deps.now ?? (() => new Date()))();
    const [promotions, total] = await Promise.all([repository.findMany(toSkipTake(pagination)), repository.count()]);
    const names = await repository.findUserNames(promotions.map((promotion) => promotion.createdByUserId));

    return {
      items: promotions.map((promotion) => toPromotionDTO(promotion, names, now)),
      pagination: buildPaginationMeta(pagination, total),
    };
  }

  static async create(actor: StrictAuthorizationActor, input: CreatePromotionInput, deps: PromotionDeps = {}): Promise<PromotionDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.manageGrants(context);

    const now = (deps.now ?? (() => new Date()))();
    const code = normalizeCode(input.code);
    const validFrom = input.validFrom ?? now;

    if (input.validUntil !== null && input.validUntil.getTime() <= Math.max(validFrom.getTime(), now.getTime())) {
      throw new PromotionWindowInvalidError();
    }

    // A code is an Offer code or a promotion code, never both (SB-CP-01).
    if (await (deps.offers ?? getOfferCodeSource()).existsInAnyMode(code)) throw new PromotionCodeTakenError();

    const created = await PromotionService.insert(actor.id, code, validFrom, input);
    const [dto] = await PromotionService.dtos([created.id], now);

    logBillingEvent("promotion.created", { promotionId: created.id, code, plan: input.plan, actorUserId: actor.id, remainingRedemptions: input.maxRedemptions });

    return dto;
  }

  private static async insert(actorId: string, code: string, validFrom: Date, input: CreatePromotionInput) {
    try {
      return await new PromotionRepository().create({
        code,
        plan: input.plan,
        durationDays: input.durationDays,
        remainingRedemptions: input.maxRedemptions,
        validFrom,
        validUntil: input.validUntil,
        eligibility: input.eligibility,
        createdByUserId: actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new PromotionCodeTakenError();

      throw error;
    }
  }

  private static async dtos(ids: readonly string[], now: Date): Promise<PromotionDTO[]> {
    const rows = await prisma.promotion.findMany({ where: { id: { in: [...ids] } }, include: { _count: { select: { redemptions: true } } } });
    const names = await new PromotionRepository().findUserNames(rows.map((row) => row.createdByUserId));

    return rows.map((row) => toPromotionDTO(row, names, now));
  }

  // -- Redemption -----------------------------------------------------------

  /**
   * Redeems `input.code` for the session user. Exactly one succeeds per user
   * per promotion, and never beyond the redemption limit, however many tabs
   * or users race for it.
   */
  static async redeem(actor: StrictAuthorizationActor, input: RedeemPromotionInput, deps: PromotionDeps = {}): Promise<RedeemedPromotionDTO> {
    const now = (deps.now ?? (() => new Date()))();
    const code = normalizeCode(input.code);
    const mode = (deps.mode ?? expectedBillingMode)();
    const userId = actor.id;

    const { promotion, grant } = await prisma.$transaction(async (tx) => {
      const promotions = new PromotionRepository(tx);
      const found = await promotions.findByCode(code);

      // Unknown, not yet valid and expired are one answer: nothing is learned about codes not usable now.
      if (!found || !isWithinWindow(found, now)) throw new PromotionCodeInvalidError();

      if (await promotions.findRedemption(found.id, userId)) throw new PromotionAlreadyRedeemedError();

      // SB-CP-04, from the user's own Subscription records (never their grants).
      const history = found.eligibility === "FIRST_PAID_SUBSCRIPTION_ONLY" ? await loadBillingHistory(tx, userId, mode) : NO_BILLING_HISTORY;

      if (!satisfiesEligibility(found.eligibility, code, history)) throw new PromotionNotEligibleError();

      // The last slot: a conditional decrement, serialized by the row lock. An unlimited promotion has none.
      if (found.remainingRedemptions !== null && (await promotions.decrementRemaining(found.id)) !== 1) {
        // A concurrent redemption by this same user may have taken the slot: say so, rather than "sold out".
        if (await promotions.findRedemption(found.id, userId)) throw new PromotionAlreadyRedeemedError();

        throw new PromotionSoldOutError();
      }

      const created = await promotions.createGrant({
        userId,
        plan: found.plan,
        promotionId: found.id,
        validFrom: now,
        validUntil: new Date(now.getTime() + found.durationDays * DAY_MS),
        reason: found.code,
      });

      try {
        await promotions.createRedemption({ promotionId: found.id, userId, grantId: created.id });
      } catch (error) {
        // The second of two tabs: the whole transaction, decrement included, rolls back.
        if (isUniqueViolation(error)) throw new PromotionAlreadyRedeemedError();

        throw error;
      }

      await new GrantRepository(tx).createAudit({
        grantId: created.id,
        action: "CREATED",
        performedByUserId: userId,
        targetUserId: userId,
        promotionId: found.id,
        plan: created.plan,
        previousValidUntil: null,
        newValidUntil: created.validUntil,
        reason: found.code,
      });

      return { promotion: found, grant: created };
    });

    // After the commit only: a rolled-back redemption reports nothing.
    logBillingEvent("grant.created", {
      grantId: grant.id,
      userId,
      plan: grant.plan,
      source: "PROMOTION",
      promotionId: promotion.id,
      validUntil: grant.validUntil?.toISOString() ?? null,
    });
    logBillingEvent("promotion.redeemed", { promotionId: promotion.id, code: promotion.code, userId, grantId: grant.id });

    return {
      code: promotion.code,
      plan: grant.plan,
      validFrom: grant.validFrom.toISOString(),
      validUntil: (grant.validUntil as Date).toISOString(),
    };
  }
}
