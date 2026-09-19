import { Prisma, TechnologyType } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { DuplicateTechnologyError, TechnologyNotFoundError } from "../errors";

export interface TechnologyWhereParams {
    q?: string;
    type?: TechnologyType;
    includeDeleted?: boolean;
}

export interface TechnologyPageParams {
    skip?: number;
    take?: number;
}

/**
 * Translates a Prisma P2002 unique-constraint violation into a domain
 * `DuplicateTechnologyError`, naming whichever of `name`/`slug` Postgres
 * actually rejected via `meta.target`. Never lets the raw Prisma error
 * escape past this layer — see `CompetitionRepository`/`DuplicateSlugError`
 * for the equivalent pattern elsewhere in the repo, though Competition only
 * ever has one unique field to report.
 */
function rethrowAsDomainError(error: unknown, fallback: { name?: string; slug?: string }): never {
    if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
    ) {
        const target = error.meta?.target;
        const targets = Array.isArray(target)
            ? target
            : typeof target === "string"
                ? [target]
                : [];

        if (targets.includes("slug") && fallback.slug !== undefined) {
            throw new DuplicateTechnologyError("slug", fallback.slug);
        }

        if (targets.includes("name") && fallback.name !== undefined) {
            throw new DuplicateTechnologyError("name", fallback.name);
        }

        // Target couldn't be resolved to a known field — report whichever
        // value we have rather than letting the raw Prisma error escape.
        if (fallback.name !== undefined) {
            throw new DuplicateTechnologyError("name", fallback.name);
        }

        if (fallback.slug !== undefined) {
            throw new DuplicateTechnologyError("slug", fallback.slug);
        }
    }

    throw error;
}

export class TechnologyRepository {
    /**
     * Database Layer
     *
     * Responsibilities
     * ----------------
     * ✓ Build Prisma queries
     * ✓ Execute database operations
     * ✓ Return Prisma models
     * ✓ Translate Prisma-specific errors (P2002, ...) into domain errors
     *
     * Does NOT
     * ----------------
     * ✗ Business rules
     * ✗ Authentication
     * ✗ Authorization
     * ✗ DTO Mapping
     */

    private static readonly iconInclude = {
        include: {
            iconAsset: true,
        },
    } satisfies Prisma.TechnologyDefaultArgs;

    static buildWhere(params: TechnologyWhereParams): Prisma.TechnologyWhereInput {
        return {
            ...(!params.includeDeleted && { deletedAt: null }),

            ...(params.type && { type: params.type }),

            ...(params.q && {
                OR: [
                    { name: { contains: params.q, mode: "insensitive" } },
                    { slug: { contains: params.q, mode: "insensitive" } },
                ],
            }),
        };
    }

    /**
     * Admin list/search. `includeDeleted` is the only thing that can widen
     * this past `deletedAt: null` — every other caller in this class goes
     * through the always-active or always-including-deleted helpers below,
     * so this is the one entry point admin listing filters flow through.
     */
    static async findMany(
        where: Prisma.TechnologyWhereInput,
        page: TechnologyPageParams = {},
    ) {
        return prisma.technology.findMany({
            where,
            ...this.iconInclude,
            orderBy: { name: "asc" },
            skip: page.skip,
            take: page.take,
        });
    }

    static async count(where: Prisma.TechnologyWhereInput) {
        return prisma.technology.count({ where });
    }

    static async findActiveById(id: string) {
        return prisma.technology.findFirst({
            where: { id, deletedAt: null },
            ...this.iconInclude,
        });
    }

    static async findActiveByIdOrThrow(id: string) {
        const technology = await this.findActiveById(id);

        if (!technology) {
            throw new TechnologyNotFoundError();
        }

        return technology;
    }

    /**
     * Like `findActiveById`, but does not exclude soft-deleted rows. Only
     * meaningful for the admin restore/edit-while-deleted paths — see
     * `TechnologyService.updateFields`/`restore`.
     */
    static async findByIdIncludingDeleted(
        id: string,
        db: Prisma.TransactionClient | Prisma.DefaultPrismaClient = prisma,
    ) {
        return db.technology.findFirst({
            where: { id },
            ...this.iconInclude,
        });
    }

    static async findByIdIncludingDeletedOrThrow(
        id: string,
        db: Prisma.TransactionClient | Prisma.DefaultPrismaClient = prisma,
    ) {
        const technology = await this.findByIdIncludingDeleted(id, db);

        if (!technology) {
            throw new TechnologyNotFoundError();
        }

        return technology;
    }

    static async findAllActive() {
        return prisma.technology.findMany({
            where: { deletedAt: null },
            ...this.iconInclude,
            orderBy: { name: "asc" },
        });
    }

    static async create(data: {
        name: string;
        slug: string;
        type: TechnologyType;
        description?: string | null;
    }) {
        try {
            return await prisma.technology.create({
                data: {
                    name: data.name,
                    slug: data.slug,
                    type: data.type,
                    description: data.description ?? null,
                },
                ...this.iconInclude,
            });
        } catch (error) {
            rethrowAsDomainError(error, { name: data.name, slug: data.slug });
        }
    }

    /**
     * Updates name/type/description. Never touches `slug` — see
     * `updateSlug`, a deliberately separate method so an edit to one can
     * never carry the other along with it.
     */
    static async updateFields(
        id: string,
        data: {
            name?: string;
            type?: TechnologyType;
            description?: string | null;
        },
    ) {
        try {
            return await prisma.technology.update({
                where: { id },
                data: {
                    ...(data.name !== undefined && { name: data.name }),
                    ...(data.type !== undefined && { type: data.type }),
                    ...(data.description !== undefined && {
                        description: data.description,
                    }),
                },
                ...this.iconInclude,
            });
        } catch (error) {
            rethrowAsDomainError(error, { name: data.name });
        }
    }

    static async updateSlug(id: string, slug: string) {
        try {
            return await prisma.technology.update({
                where: { id },
                data: { slug },
                ...this.iconInclude,
            });
        } catch (error) {
            rethrowAsDomainError(error, { slug });
        }
    }

    static async softDelete(id: string) {
        return prisma.technology.update({
            where: { id },
            data: { deletedAt: new Date() },
            ...this.iconInclude,
        });
    }

    static async restore(id: string) {
        return prisma.technology.update({
            where: { id },
            data: { deletedAt: null },
            ...this.iconInclude,
        });
    }

    static async setIcon(
        tx: Prisma.TransactionClient,
        id: string,
        assetId: string,
    ) {
        return tx.technology.update({
            where: { id },
            data: {
                iconAsset: {
                    connect: { id: assetId },
                },
            },
        });
    }

    static async clearIcon(tx: Prisma.TransactionClient, id: string) {
        return tx.technology.update({
            where: { id },
            data: {
                iconAsset: {
                    disconnect: true,
                },
            },
        });
    }

    static async countByState(): Promise<{ active: number; deleted: number }> {
        const [active, deleted] = await Promise.all([
            prisma.technology.count({ where: { deletedAt: null } }),
            prisma.technology.count({ where: { deletedAt: { not: null } } }),
        ]);

        return { active, deleted };
    }
}
