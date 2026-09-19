import type { StrictAuthorizationActor } from "@/authorization";
import { AssetPurpose } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import {
    buildPaginationMeta,
    parsePagination,
    type RawSearchParams,
} from "@/lib/search";
import { assertAssetReferenceAllowed } from "@/modules/assets/backend/reference-policy";
import { assetService } from "@/modules/assets/backend/service";

import { TechnologyAuthorizer } from "./authorization/authorizer";
import type { TechnologyAdminDTO, TechnologyCatalogDTO } from "./dto";
import { technologyMapper } from "./mapper";
import { TechnologyRepository } from "./repository";
import type { CreateTechnologyInput } from "../schemas/create-technology";
import type { UpdateTechnologyFieldsInput } from "../schemas/update-technology-fields";
import { TechnologyListQuerySchema } from "../schemas/technology-list-query";
import { generateTechnologySlug } from "../utils/slug";

export interface TechnologySearchResult {
    items: TechnologyAdminDTO[];
    pagination: ReturnType<typeof buildPaginationMeta>;
}

export class TechnologyService {
    /**
     * Business Layer
     *
     * Responsibilities
     * ----------------
     * ✓ Business rules
     * ✓ Repository orchestration
     * ✓ Domain validation
     * ✓ Pagination
     * ✓ Mapping database models
     *
     * Does NOT
     * ----------------
     * ✗ Parse HTTP requests
     * ✗ Authenticate users
     * ✗ Authorize users (beyond calling the authorizer)
     * ✗ Query Prisma directly
     * ✗ Return NextResponse
     */

    /**
     * Admin list/search. Platform-gated — this whole surface (including
     * viewing soft-deleted rows via `includeDeleted`) is the Technology
     * management console, not a consumer-facing listing. See `getCatalog`
     * for the authenticated-only, always-active-only alternative every
     * attach picker uses instead.
     */
    static async search(
        actor: StrictAuthorizationActor,
        query: RawSearchParams,
    ): Promise<TechnologySearchResult> {
        TechnologyAuthorizer.manage({ actor });

        const filters = TechnologyListQuerySchema.parse({
            q: query.q,
            type: query.type,
            includeDeleted: query.includeDeleted,
        });

        const pagination = parsePagination(query);

        const where = TechnologyRepository.buildWhere(filters);

        const [technologies, total] = await Promise.all([
            TechnologyRepository.findMany(where, {
                skip: (pagination.page - 1) * pagination.limit,
                take: pagination.limit,
            }),
            TechnologyRepository.count(where),
        ]);

        const items = technologies.map((technology) =>
            technologyMapper.toAdminDTO(
                technology,
                technologyMapper.permissionsFor(technology),
            ),
        );

        return {
            items,
            pagination: buildPaginationMeta(pagination, total),
        };
    }

    /**
     * A single row for the admin edit view. Uses the deleted-inclusive
     * lookup — same reasoning as `updateFields`: an admin should be able to
     * open a soft-deleted Technology's detail/edit view (to fix a typo
     * before restoring it, say), not just the active ones the listing shows
     * by default.
     */
    static async getById(
        actor: StrictAuthorizationActor,
        id: string,
    ): Promise<TechnologyAdminDTO> {
        TechnologyAuthorizer.manage({ actor });

        const technology = await TechnologyRepository.findByIdIncludingDeletedOrThrow(id);

        return technologyMapper.toAdminDTO(
            technology,
            technologyMapper.permissionsFor(technology),
        );
    }

    static async getAdminSummary(): Promise<{
        total: number;
        active: number;
        deleted: number;
    }> {
        const { active, deleted } = await TechnologyRepository.countByState();

        return { total: active + deleted, active, deleted };
    }

    static async create(
        actor: StrictAuthorizationActor,
        input: CreateTechnologyInput,
    ): Promise<TechnologyAdminDTO> {
        TechnologyAuthorizer.manage({ actor });

        const slug = generateTechnologySlug(input.name);

        const technology = await TechnologyRepository.create({
            name: input.name,
            slug,
            type: input.type,
            description: input.description ?? null,
        });

        return technologyMapper.toAdminDTO(
            technology,
            technologyMapper.permissionsFor(technology),
        );
    }

    /**
     * Updates name/type/description. Deliberately looks the row up via
     * `findByIdIncludingDeletedOrThrow` rather than the active-only lookup:
     * per product decision, editing a Technology's descriptive fields is
     * allowed even while it is soft-deleted (an admin correcting a typo on
     * a row they are about to restore, say), unlike delete/restore
     * themselves which do care about the row's current state.
     */
    static async updateFields(
        actor: StrictAuthorizationActor,
        id: string,
        input: UpdateTechnologyFieldsInput,
    ): Promise<TechnologyAdminDTO> {
        TechnologyAuthorizer.manage({ actor });

        await TechnologyRepository.findByIdIncludingDeletedOrThrow(id);

        const technology = await TechnologyRepository.updateFields(id, {
            name: input.name,
            type: input.type,
            description: input.description,
        });

        return technologyMapper.toAdminDTO(
            technology,
            technologyMapper.permissionsFor(technology),
        );
    }

    /**
     * Changes only the slug — a separate method (and separate endpoint) so
     * a name/type/description edit can never accidentally carry a slug
     * change with it, or vice versa. Same edit-while-deleted allowance as
     * `updateFields`.
     */
    static async updateSlug(
        actor: StrictAuthorizationActor,
        id: string,
        slug: string,
    ): Promise<TechnologyAdminDTO> {
        TechnologyAuthorizer.manage({ actor });

        await TechnologyRepository.findByIdIncludingDeletedOrThrow(id);

        const technology = await TechnologyRepository.updateSlug(id, slug);

        return technologyMapper.toAdminDTO(
            technology,
            technologyMapper.permissionsFor(technology),
        );
    }

    /**
     * Soft delete. Requires the row to currently be active — deleting an
     * already-deleted row is not a meaningful request (there is nothing
     * `restore` would be undoing that this call would have caused), so this
     * uses the active-only lookup and 404s otherwise.
     */
    static async softDelete(
        actor: StrictAuthorizationActor,
        id: string,
    ): Promise<void> {
        TechnologyAuthorizer.manage({ actor });

        await TechnologyRepository.findActiveByIdOrThrow(id);

        await TechnologyRepository.softDelete(id);
    }

    /**
     * Reverses a soft delete. Only ever meaningful on a row the ordinary,
     * active-only lookup treats as not found — see
     * `CompetitionService.restore` for the same shape elsewhere in the repo.
     */
    static async restore(
        actor: StrictAuthorizationActor,
        id: string,
    ): Promise<void> {
        TechnologyAuthorizer.manage({ actor });

        await TechnologyRepository.findByIdIncludingDeletedOrThrow(id);

        await TechnologyRepository.restore(id);
    }

    /**
     * Attaches (or, with `assetId: null`, clears) a Technology's icon.
     * Mirrors `CompetitionAssetService.setAsset`: asset-side reference
     * validation happens outside the transaction (nothing to roll back if
     * it fails), the previous icon is captured before the write, and the
     * old Asset is detached — if nothing else still references it — inside
     * the same transaction that reassigns the icon. Allowed even while the
     * Technology is soft-deleted, for the same reason `updateFields` is.
     */
    static async setIcon(
        actor: StrictAuthorizationActor,
        id: string,
        assetId: string | null,
    ): Promise<TechnologyAdminDTO> {
        TechnologyAuthorizer.manage({ actor });

        const technology = await TechnologyRepository.findByIdIncludingDeletedOrThrow(id);

        if (assetId !== null) {
            await assertAssetReferenceAllowed({
                assetId,
                purpose: AssetPurpose.TECHNOLOGY_ICON,
            });
        }

        const previousAssetId = technology.iconAssetId;

        return prisma.$transaction(async (tx) => {
            // Authoritative, race-safe re-validation under lock — see
            // AssetService.prepareAssetAttach. The pre-transaction
            // assertAssetReferenceAllowed call above is a fast-fail check
            // only.
            await assetService.prepareAssetAttach(tx, {
                assetId,
                previousAssetId,
                purpose: AssetPurpose.TECHNOLOGY_ICON,
            });

            if (assetId === null) {
                await TechnologyRepository.clearIcon(tx, id);
            } else {
                await TechnologyRepository.setIcon(tx, id, assetId);
            }

            if (previousAssetId && previousAssetId !== assetId) {
                await assetService.detachIfUnreferenced(tx, previousAssetId);
            }

            const updated = await TechnologyRepository.findByIdIncludingDeletedOrThrow(
                id,
                tx,
            );

            return technologyMapper.toAdminDTO(
                updated,
                technologyMapper.permissionsFor(updated),
            );
        });
    }

    static async clearIcon(
        actor: StrictAuthorizationActor,
        id: string,
    ): Promise<TechnologyAdminDTO> {
        return this.setIcon(actor, id, null);
    }

    /**
     * The catalog every Project/Competition/Portfolio attach picker
     * consumes. Requires only that the caller be authenticated — NOT the
     * `MANAGE_TECHNOLOGIES` platform capability, which is why this does not
     * call `TechnologyAuthorizer.manage`. `actor` is accepted (and required
     * by the controller's own authentication check before this is ever
     * reached) purely to keep this method's signature honest about that
     * requirement; nothing here reads from it. Never returns a
     * soft-deleted row, for any caller — attaching a deleted Technology is
     * out of scope for this module entirely (see `findAllActive`, which is
     * always `deletedAt: null`, full stop).
     */
    static async getCatalog(
        actor: StrictAuthorizationActor,
    ): Promise<TechnologyCatalogDTO[]> {
        void actor;

        const technologies = await TechnologyRepository.findAllActive();

        return technologies.map((technology) =>
            technologyMapper.toCatalogDTO(technology),
        );
    }
}

export const technologyService = new TechnologyService();
