import type { TechnologyType } from "@/generated/prisma";
import type { AssetDTO } from "@/modules/assets/dto/asset.dto";

import type { TechnologyPermissionsDTO } from "./technology-permissions.dto";

export interface TechnologyAdminDTO {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly type: TechnologyType;
    readonly description: string | null;
    readonly iconAsset: AssetDTO | null;
    readonly deletedAt: Date | null;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly permissions: TechnologyPermissionsDTO;
}
