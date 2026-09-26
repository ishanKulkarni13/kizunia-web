/**
 * Billing — Promotion Repository
 *
 * Database access only; no business rules. Constructed on the default client
 * or on a transaction client (`new PromotionRepository(tx)`), like
 * `GrantRepository`.
 */
import type { CodeEligibility, EntitlementGrant, MembershipPlan, Prisma, PrismaClient, Promotion, PromotionRedemption } from "@/generated/prisma";
import prisma from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

export type PromotionWithCount = Prisma.PromotionGetPayload<{ include: { _count: { select: { redemptions: true } } } }>;

export class PromotionRepository {
  constructor(private readonly db: Db = prisma) {}

  /** `code` is already normalized (`normalizeCode`). */
  async findByCode(code: string): Promise<Promotion | null> {
    return this.db.promotion.findUnique({ where: { code } });
  }

  async create(data: {
    readonly code: string;
    readonly plan: MembershipPlan;
    readonly durationDays: number;
    readonly remainingRedemptions: number | null;
    readonly validFrom: Date;
    readonly validUntil: Date | null;
    readonly eligibility: CodeEligibility;
    readonly createdByUserId: string;
  }): Promise<Promotion> {
    return this.db.promotion.create({ data });
  }

  async findMany(page: { readonly skip: number; readonly take: number }): Promise<PromotionWithCount[]> {
    return this.db.promotion.findMany({
      include: { _count: { select: { redemptions: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: page.skip,
      take: page.take,
    });
  }

  async count(): Promise<number> {
    return this.db.promotion.count();
  }

  async findUserNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    const users = await this.db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });

    return new Map(users.map((user) => [user.id, user.name]));
  }

  async findRedemption(promotionId: string, userId: string): Promise<PromotionRedemption | null> {
    return this.db.promotionRedemption.findUnique({ where: { promotionId_userId: { promotionId, userId } } });
  }

  /**
   * The conditional decrement: takes one slot only while one is left
   * (`remainingRedemptions > 0`). Returns the number of rows changed, 0 or 1;
   * 0 means sold out. Two users racing for the last slot are serialized by the
   * row lock this takes: the second re-evaluates the condition after the first
   * commits and matches nothing. An unlimited promotion (`null`) never calls this.
   */
  async decrementRemaining(promotionId: string): Promise<number> {
    const result = await this.db.promotion.updateMany({
      where: { id: promotionId, remainingRedemptions: { gt: 0 } },
      data: { remainingRedemptions: { decrement: 1 } },
    });

    return result.count;
  }

  /** The grant a redemption creates: source PROMOTION, no granting administrator (the redeemer is the actor). */
  async createGrant(data: {
    readonly userId: string;
    readonly plan: MembershipPlan;
    readonly promotionId: string;
    readonly validFrom: Date;
    readonly validUntil: Date;
    readonly reason: string;
  }): Promise<EntitlementGrant> {
    return this.db.entitlementGrant.create({ data: { ...data, source: "PROMOTION", status: "ACTIVE", grantedByUserId: null } });
  }

  async createRedemption(data: { readonly promotionId: string; readonly userId: string; readonly grantId: string }): Promise<PromotionRedemption> {
    return this.db.promotionRedemption.create({ data });
  }
}
