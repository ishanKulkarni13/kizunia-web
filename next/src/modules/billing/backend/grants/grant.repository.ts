/**
 * Billing — Entitlement Grant Repository
 *
 * Database access only; no business rules. Constructed on the default client
 * or on a transaction client (`new GrantRepository(tx)`), the same shape as the
 * users and assets repositories.
 */
import type {
  EntitlementGrant,
  GrantAuditAction,
  MembershipPlan,
  Prisma,
  PrismaClient,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import type { GrantListFilter } from "../../schemas/grant";

type Db = PrismaClient | Prisma.TransactionClient;

export interface GrantRecipientRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly username: string | null;
}

const recipientSelect = {
  id: true,
  name: true,
  email: true,
  username: true,
} satisfies Prisma.UserSelect;

export const grantListInclude = {
  user: { select: recipientSelect },
  auditEntries: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.EntitlementGrantInclude;

export type GrantWithRelations = Prisma.EntitlementGrantGetPayload<{
  include: typeof grantListInclude;
}>;

export class GrantRepository {
  constructor(private readonly db: Db = prisma) {}

  async findRecipient(
    recipient: { readonly userId: string } | { readonly email: string },
  ): Promise<GrantRecipientRow | null> {
    return this.db.user.findUnique({
      where: "userId" in recipient ? { id: recipient.userId } : { email: recipient.email },
      select: recipientSelect,
    });
  }

  async create(data: {
    readonly userId: string;
    readonly plan: MembershipPlan;
    readonly validFrom: Date;
    readonly validUntil: Date | null;
    readonly grantedByUserId: string;
    readonly reason: string;
  }): Promise<EntitlementGrant> {
    return this.db.entitlementGrant.create({
      data: { ...data, source: "ADMIN_GRANT", status: "ACTIVE" },
    });
  }

  /**
   * Takes a row lock on the grant for the rest of the transaction and returns
   * the row as it is under that lock, or `null` if it does not exist.
   *
   * Every mutation of a grant goes through this first, so two concurrent
   * mutations (extend vs. revoke) serialize: the second one reads the first
   * one's committed result and decides from it — which is what makes a revoked
   * grant impossible to resurrect.
   *
   * Must only be called on a repository constructed with a transaction client;
   * outside a transaction the lock would be released immediately.
   */
  async lockById(id: string): Promise<EntitlementGrant | null> {
    const locked = await this.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "entitlement_grant" WHERE id = ${id} FOR UPDATE
    `;

    if (locked.length === 0) return null;

    return this.db.entitlementGrant.findUnique({ where: { id } });
  }

  async findByIdWithRelations(id: string): Promise<GrantWithRelations | null> {
    return this.db.entitlementGrant.findUnique({
      where: { id },
      include: grantListInclude,
    });
  }

  /**
   * Sets a new end of validity on an ACTIVE grant. The `status` condition is
   * belt and braces behind the row lock: an update never lands on a revoked
   * grant. Returns the number of rows changed (0 or 1).
   */
  async updateValidUntil(id: string, validUntil: Date | null): Promise<number> {
    const result = await this.db.entitlementGrant.updateMany({
      where: { id, status: "ACTIVE" },
      data: { validUntil },
    });

    return result.count;
  }

  /** Revokes an ACTIVE grant. Returns the number of rows changed (0 or 1). */
  async revoke(
    id: string,
    data: { readonly revokedAt: Date; readonly revokedByUserId: string; readonly revokeReason: string },
  ): Promise<number> {
    const result = await this.db.entitlementGrant.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "REVOKED", ...data },
    });

    return result.count;
  }

  async createAudit(data: {
    readonly grantId: string;
    readonly action: GrantAuditAction;
    readonly performedByUserId: string;
    readonly targetUserId: string | null;
    readonly plan: MembershipPlan;
    readonly previousValidUntil: Date | null;
    readonly newValidUntil: Date | null;
    readonly reason: string;
  }): Promise<void> {
    await this.db.grantAuditEntry.create({ data });
  }

  static buildWhere(filter: GrantListFilter): Prisma.EntitlementGrantWhereInput {
    return {
      ...(filter.userId !== undefined && { userId: filter.userId }),
      ...(filter.email !== undefined && { user: { email: filter.email } }),
      ...(filter.status !== undefined && { status: filter.status }),
    };
  }

  async findMany(
    where: Prisma.EntitlementGrantWhereInput,
    page: { readonly skip: number; readonly take: number },
  ): Promise<GrantWithRelations[]> {
    return this.db.entitlementGrant.findMany({
      where,
      include: grantListInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: page.skip,
      take: page.take,
    });
  }

  async count(where: Prisma.EntitlementGrantWhereInput): Promise<number> {
    return this.db.entitlementGrant.count({ where });
  }

  /** Display names for actor ids (grantors, revokers, audit performers). */
  async findUserNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    const users = await this.db.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });

    return new Map(users.map((user) => [user.id, user.name]));
  }
}
