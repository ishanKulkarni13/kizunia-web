/**
 * Users Module — Mapper
 *
 * Responsible for converting between database models and DTOs.
 * Prisma models should never be returned directly.
 */

import type { User } from "@/generated/prisma";
import { buildAssetViewUrl } from "@/modules/assets/backend/download-url";

import type { UserAssetSlot } from "../types/asset-slot";
import type { UserAssetDTO, UserDTO } from "../types";
import type { UserWithAssets } from "./repository";

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    image: user.image,
    role: user.role,
    createdAt: user.createdAt,
  };
}

/** Maps the slot that was just set/cleared to its response DTO. */
export function toUserAssetDTO(
  user: UserWithAssets,
  slot: UserAssetSlot,
): UserAssetDTO {
  const asset = slot === "avatar" ? user.avatarAsset : user.coverAsset;

  return {
    slot,
    assetId: asset?.id ?? null,
    url: asset ? buildAssetViewUrl(asset) : null,
  };
}
