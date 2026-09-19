import type { Asset, Technology } from "@/generated/prisma";
import { assetMapper } from "@/modules/assets/mapper/asset.mapper";

import type {
    TechnologyAdminDTO,
    TechnologyCatalogDTO,
    TechnologyPermissionsDTO,
} from "./dto";

type TechnologyWithIcon = Technology & { iconAsset: Asset | null };

export class TechnologyMapper {
    toAdminDTO(
        technology: TechnologyWithIcon,
        permissions: TechnologyPermissionsDTO,
    ): TechnologyAdminDTO {
        return {
            id: technology.id,
            name: technology.name,
            slug: technology.slug,
            type: technology.type,
            description: technology.description,
            iconAsset: technology.iconAsset
                ? assetMapper.toDTO(technology.iconAsset)
                : null,
            deletedAt: technology.deletedAt,
            createdAt: technology.createdAt,
            updatedAt: technology.updatedAt,
            permissions,
        };
    }

    toCatalogDTO(technology: TechnologyWithIcon): TechnologyCatalogDTO {
        return {
            id: technology.id,
            name: technology.name,
            slug: technology.slug,
            type: technology.type,
            iconAsset: technology.iconAsset
                ? assetMapper.toDTO(technology.iconAsset)
                : null,
        };
    }

    /**
     * The permissions object is identical for every row `TechnologyService`
     * returns today, because there is no per-row policy — only the single
     * platform gate, already asserted before any row is ever mapped, plus
     * the row's own soft-delete state. Computed from data rather than a
     * hardcoded `{ true, true, true }` so a genuinely deleted row correctly
     * reports `canDelete: false` / `canRestore: true`.
     */
    permissionsFor(technology: Pick<Technology, "deletedAt">): TechnologyPermissionsDTO {
        const isDeleted = technology.deletedAt !== null;

        return {
            canEdit: true,
            canDelete: !isDeleted,
            canRestore: isDeleted,
        };
    }
}

export const technologyMapper = new TechnologyMapper();
