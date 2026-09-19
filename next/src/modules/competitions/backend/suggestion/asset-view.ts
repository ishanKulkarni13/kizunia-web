/**
 * Attaches the provider-computed `viewUrl`/`downloadUrl` to a suggestion's
 * assets as they leave the service.
 *
 * This is presentation, not persistence — it never touches the repository or
 * the stored Asset row.
 *
 * It runs in the *service*, not the controller, deliberately: the admin and
 * contributor detail pages are Server Components that call the service
 * directly and never go through an API route, so enriching at the controller
 * boundary left those pages with bare Asset rows and no working links at all.
 * The service is the narrowest boundary both callers actually share.
 */

import type { AssetCategory } from "@/generated/prisma";

import {
  buildAssetDownloadUrl,
  buildAssetViewUrl,
} from "@/modules/assets/backend/download-url";

interface AssetLike {
  publicId: string;
  secureUrl: string;
  category: AssetCategory;
  format: string | null;
  originalFilename: string | null;
}

interface SuggestionAssetLike {
  asset: AssetLike;
}

interface SuggestionWithAssetsLike {
  assets: SuggestionAssetLike[];
}

function withDownloadUrl<T extends SuggestionAssetLike>(item: T): T {
  return {
    ...item,
    asset: {
      ...item.asset,
      viewUrl: buildAssetViewUrl(item.asset),
      downloadUrl: buildAssetDownloadUrl(item.asset),
    },
  };
}

export function withAssetDownloadUrls<T extends SuggestionWithAssetsLike>(
  suggestion: T,
): T {
  return {
    ...suggestion,
    assets: suggestion.assets.map((item) => withDownloadUrl(item)),
  };
}

export function withAssetDownloadUrlsMany<T extends SuggestionWithAssetsLike>(
  suggestions: T[],
): T[] {
  return suggestions.map((suggestion) => withAssetDownloadUrls(suggestion));
}
