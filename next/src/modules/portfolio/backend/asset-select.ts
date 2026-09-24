/**
 * The Asset fields Portfolio needs to render an asset it hands to a client.
 *
 * `publicId` and `category` are not presentation data: they are the inputs
 * `buildAssetViewUrl` needs to turn a stored asset into a URL that can
 * actually be opened. For a DOCUMENT (a resume) the stored `secureUrl` is
 * undeliverable, so it must never be emitted directly — see
 * `PortfolioMapper` and assets/backend/download-url.ts. Neither field is ever
 * copied into a DTO.
 */

import type { Prisma } from "@/generated/prisma";

export const portfolioAssetSelect = {
  id: true,
  secureUrl: true,
  publicId: true,
  category: true,
  width: true,
  height: true,
  format: true,
  mimeType: true,
} satisfies Prisma.AssetSelect;

export type PortfolioAssetEntity = Prisma.AssetGetPayload<{
  select: typeof portfolioAssetSelect;
}>;
