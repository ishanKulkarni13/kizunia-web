import type { Asset } from "@/generated/prisma";
import type { AssetDTO } from "../dto/asset.dto";

export class AssetMapper {
  toDTO(asset: Asset): AssetDTO {
    return {
      id: asset.id,

      publicId: asset.publicId,

      secureUrl: asset.secureUrl,

      format: asset.format,

      mimeType: asset.mimeType,

      width: asset.width,

      height: asset.height,

      bytes: asset.bytes,

      originalFilename: asset.originalFilename,

      status: asset.status,

      category: asset.category,
    };
  }
}

export const assetMapper = new AssetMapper();