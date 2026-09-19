/**
 * Thin convenience wrappers around the active StorageProvider's URL
 * builders — the one place outside the provider adapter that's allowed to
 * know that a viewable/downloadable URL is a provider-computed thing, not a
 * static field on the Asset record.
 */

import type { AssetCategory } from "@/generated/prisma";

import { getStorageProvider } from "./storage";

export function buildAssetDownloadUrl(asset: {
  publicId: string;
  category: AssetCategory;
  format?: string | null;
  originalFilename?: string | null;
}): string {
  return getStorageProvider().buildDownloadUrl({
    publicId: asset.publicId,
    category: asset.category,
    format: asset.format,
    filename: asset.originalFilename,
  });
}

/**
 * The URL a "View" affordance should open. Not interchangeable with the
 * stored `secureUrl`: for some categories the provider cannot deliver that
 * URL at all and hands back a different, usable one.
 */
export function buildAssetViewUrl(asset: {
  publicId: string;
  category: AssetCategory;
  secureUrl: string;
}): string {
  return getStorageProvider().buildViewUrl({
    publicId: asset.publicId,
    category: asset.category,
    secureUrl: asset.secureUrl,
  });
}

/**
 * A durable URL safe to place in a list/preview/detail payload, or `null`
 * when this Asset's category can only be delivered via a signed, temporary
 * URL — see StorageProvider.buildDurableViewUrl. Used by the Asset admin
 * mapper; never by the ordinary (non-admin) Asset DTO.
 */
export function buildAssetDurableViewUrl(asset: {
  publicId: string;
  category: AssetCategory;
  secureUrl: string;
}): string | null {
  return getStorageProvider().buildDurableViewUrl({
    publicId: asset.publicId,
    category: asset.category,
    secureUrl: asset.secureUrl,
  });
}
