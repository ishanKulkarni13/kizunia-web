/**
 * Technologies Module - Controller
 *
 * Responsible for:
 * - Request parsing
 * - Authentication checks
 * - Calling services
 * - Returning responses
 *
 * Controllers should never contain business logic.
 */

import { NextRequest } from "next/server";

import { SessionService } from "@/lib/auth/index";
import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { SetAssetSchema } from "@/modules/assets/schemas/set-asset";

import { TechnologyService } from "./service";
import { CreateTechnologySchema } from "../schemas/create-technology";
import { UpdateTechnologyFieldsSchema } from "../schemas/update-technology-fields";
import { UpdateTechnologySlugSchema } from "../schemas/update-technology-slug";

export class TechnologyController {
    static async search(request: NextRequest) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            const query = Object.fromEntries(request.nextUrl.searchParams.entries());

            const technologies = await TechnologyService.search(actor, query);

            return ApiResponse.ok(technologies);
        });
    }

    static async findById(request: NextRequest, technologyId: string) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            const technology = await TechnologyService.getById(actor, technologyId);

            return ApiResponse.ok(technology);
        });
    }

    static async create(request: NextRequest) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            const body = await request.json();

            const data = CreateTechnologySchema.parse(body);

            const technology = await TechnologyService.create(actor, data);

            return ApiResponse.created(technology);
        });
    }

    static async updateFields(request: NextRequest, technologyId: string) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            const body = await request.json();

            const data = UpdateTechnologyFieldsSchema.parse(body);

            const technology = await TechnologyService.updateFields(
                actor,
                technologyId,
                data,
            );

            return ApiResponse.ok(technology);
        });
    }

    static async updateSlug(request: NextRequest, technologyId: string) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            const body = await request.json();

            const { slug } = UpdateTechnologySlugSchema.parse(body);

            const technology = await TechnologyService.updateSlug(
                actor,
                technologyId,
                slug,
            );

            return ApiResponse.ok(technology);
        });
    }

    static async delete(request: NextRequest, technologyId: string) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            await TechnologyService.softDelete(actor, technologyId);

            return ApiResponse.ok({});
        });
    }

    static async restore(request: NextRequest, technologyId: string) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            await TechnologyService.restore(actor, technologyId);

            return ApiResponse.ok({});
        });
    }

    static async setIcon(request: NextRequest, technologyId: string) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            const body = await request.json();

            const { assetId } = SetAssetSchema.parse(body);

            const technology = await TechnologyService.setIcon(
                actor,
                technologyId,
                assetId,
            );

            return ApiResponse.ok(technology);
        });
    }

    static async clearIcon(request: NextRequest, technologyId: string) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            const technology = await TechnologyService.clearIcon(
                actor,
                technologyId,
            );

            return ApiResponse.ok(technology);
        });
    }

    /**
     * Authenticated-only, not `MANAGE_TECHNOLOGIES`-gated — any signed-in
     * user may read the catalog every attach picker needs. See
     * `TechnologyService.getCatalog`.
     */
    static async getCatalog(request: NextRequest) {
        return Route.execute(async () => {
            const actor = await SessionService.getStrictActor(request);

            const catalog = await TechnologyService.getCatalog(actor);

            return ApiResponse.ok(catalog);
        });
    }
}
