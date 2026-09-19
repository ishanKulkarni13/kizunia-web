/**
 * Users Module — Repository
 *
 * Responsible only for database access. No business rules.
 */

import type { Prisma, PrismaClient, User } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import type { UserAssetSlot } from "../types/asset-slot";

const SLOT_RELATION_FIELD = {
  avatar: "avatarAsset",
  cover: "coverAsset",
} as const satisfies Record<UserAssetSlot, string>;

/** `User` with its avatar/cover Asset relations resolved. */
export type UserWithAssets = Prisma.UserGetPayload<{
  include: { avatarAsset: true; coverAsset: true };
}>;

export class UserRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  /**
   * Connects or clears the given slot's Asset relation. Scoped to `id` so
   * this can only ever act on one specific user row; callers are
   * responsible for confirming that row is the caller's own before
   * invoking this (see UserService.setAsset).
   */
  async setAsset(
    id: string,
    slot: UserAssetSlot,
    assetId: string | null,
  ): Promise<UserWithAssets> {
    return this.db.user.update({
      where: { id },
      data: {
        [SLOT_RELATION_FIELD[slot]]:
          assetId === null ? { disconnect: true } : { connect: { id: assetId } },
      },
      include: { avatarAsset: true, coverAsset: true },
    });
  }
}
