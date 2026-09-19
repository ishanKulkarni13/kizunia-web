/**
 * Resolves the active StorageProvider. Cloudinary today — this is the one
 * seam a future provider migration would replace, per
 * docs/architecture/domain/assets/storage.md. Nothing else in the Asset
 * application layer should import CloudinaryStorageProvider directly.
 */

import { CloudinaryStorageProvider } from "./cloudinary.provider";
import type { StorageProvider } from "./storage-provider";

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!provider) {
    provider = new CloudinaryStorageProvider();
  }

  return provider;
}

export type {
  StorageAuthorizeUploadInput,
  StorageConfirmUploadInput,
  StorageConfirmedObject,
  StorageProvider,
  StorageUploadAuthorization,
} from "./storage-provider";
