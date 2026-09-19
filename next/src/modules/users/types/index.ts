/**
 * Users Module — Types
 */

import type { UserAssetSlot } from "./asset-slot";

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  username: string | null;
  image: string | null;
  role: string | null;
  createdAt: Date;
}

/**
 * Response shape for setting/replacing/clearing a User's avatar or cover
 * Asset. Deliberately narrow — only the slot that changed, the Asset id now
 * referenced (or null), and a resolved, provider-computed view URL. Never
 * the raw Asset row: no `publicId`/`secureUrl` (Cloudinary object
 * identifiers) leak through this response, consistent with the redaction
 * already required of admin-facing Asset DTOs elsewhere in this domain.
 */
export interface UserAssetDTO {
  slot: UserAssetSlot;
  assetId: string | null;
  url: string | null;
}

export * from "./asset-slot";
