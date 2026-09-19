/**
 * Assets Module - Public API
 *
 * Import from this file only where practical. Note: as with other Kizunia
 * modules, some cross-module consumers import specific backend files
 * directly (e.g. `reference-policy`, `service`) rather than through this
 * barrel — that mirrors the existing convention elsewhere in the repo
 * (see modules/competitions, modules/projects).
 *
 * @example
 * import { assetService, assertAssetReferenceAllowed } from "@/modules/assets";
 */

export { assetService, AssetService } from "./backend/service";
export {
  uploadIntentService,
  UploadIntentService,
} from "./backend/upload-intent.service";
export { assertAssetReferenceAllowed } from "./backend/reference-policy";
export { AssetReconciliationService, assetReconciliationService } from "./backend/reconciliation.service";
export { getUploadPolicy, UPLOAD_POLICIES } from "./backend/policies/upload-policy";
export type { UploadPolicy } from "./backend/policies/upload-policy";

export type { AssetDTO } from "./dto/asset.dto";
