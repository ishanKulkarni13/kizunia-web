import type { TechnologyType } from "@/generated/prisma";
import type { AssetDTO } from "@/modules/assets/dto/asset.dto";

/**
 * The lightweight shape returned by the public/authenticated catalog
 * endpoint — everything Project/Competition/Portfolio attach pickers need
 * and nothing more (no `description`, no `permissions`, no `deletedAt`:
 * the catalog never returns a deleted row in the first place).
 */
export interface TechnologyCatalogDTO {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly type: TechnologyType;
    readonly iconAsset: AssetDTO | null;
}
