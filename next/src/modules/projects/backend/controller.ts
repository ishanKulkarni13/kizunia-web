/**
 * Projects Module - Controller
 *
 * Responsible for:
 * - Request parsing
 * - Authentication
 * - Validation
 * - Calling services
 * - Returning responses
 *
 * Controllers should never contain business logic or authorization.
 */

import { NextRequest } from "next/server";

import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";

import { UnauthorizedError } from "@/lib/errors";
import { projectService } from "./service";
import { projectLinkService } from "./project-link.service";
import { projectTestimonialService } from "./project-testimonial.service";
import { projectTechnologyService } from "./project-technology.service";
import { ProjectMineQuerySchema } from "../search";
import { SessionService } from "@/lib/auth/session";
import { CreateProjectSchema, DeleteProjectSchema } from "../schemas";
import { AuthorizationActor, PlatformRole } from "@/authorization";
import { UpdateProjectProfileDto, UpdateProjectContentDto } from "./dto/input";
import { ProjectDetailsDto } from "./dto/output";
import { UpdateProjectProfileSchema } from "../schemas/update-project-profile.schema";
import { UpdateProjectContentSchema } from "./dto/input/update-project-content.schema";
import {
  CreateProjectLinkSchema,
  ReorderProjectLinksSchema,
  UpdateProjectLinkSchema,
} from "../schemas/project-link.schema";
import {
  CreateProjectTestimonialSchema,
  ReorderProjectTestimonialsSchema,
  UpdateProjectTestimonialSchema,
} from "../schemas/project-testimonial.schema";
import {
  AttachProjectTechnologySchema,
  ReorderProjectTechnologiesSchema,
} from "../schemas/project-technology.schema";
import { SetAssetSchema } from "@/modules/assets/schemas/set-asset";
import { ValidationError } from "@/lib/errors";
import { isProjectAssetSlot } from "../types/asset-slot";

export class ProjectController {
  // ===========================================================================
  // Read
  // ===========================================================================

  /**
   * The public `/projects` discovery listing.
   *
   * Unlike every other read here, there is no schema `.parse()` step: raw
   * params are handed straight to `projectService.search`, which validates
   * and decodes them through the search registry (`search/definition.ts`)
   * rather than a hand-written schema. This mirrors
   * `CompetitionController.search` — see that method for why an unparsed
   * `RawSearchParams` bag, not a typed DTO, is the correct shape at this
   * boundary for a search-core-backed listing.
   */
  static async findMany({ request }: { request: NextRequest }) {
    return Route.execute(async () => {
      const query = Object.fromEntries(request.nextUrl.searchParams.entries());

      const actor = await SessionService.getOptionalActor(request);
      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const actorData = {
        id: actor?.id ?? null,
        role: actor?.role ?? PlatformRole.USER,
        banned: actor?.banned ?? false,
      };

      const result = await projectService.search(query, actorData);

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(result);
    });
  }

  /**
   * Projects the authenticated actor is a member of. The actor is always
   * derived from the session — there is no `userId` query param to accept.
   */
  static async findMine(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      const query = Object.fromEntries(request.nextUrl.searchParams.entries());

      const filters = ProjectMineQuerySchema.parse(query);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const result = await projectService.findMine({
        actor,
        query: filters,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(result);
    });
  }

  static async findBySlug(request: NextRequest, slug: string) {
    //public
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication (Optional)
      // -----------------------------------------------------------------------

      const actor = await SessionService.getOptionalActor(request);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const project = await projectService.findBySlug({
        slug,

        actor: {
          id: actor?.id ?? null,
          role: actor?.role ?? null,
          banned: actor?.banned ?? null,
        },
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(project);
    });
  }

  static async findById(
  request: NextRequest,
  projectId: string,
) {
  return Route.execute(async () => {
    // =========================================================================
    // Authentication
    // =========================================================================

    const actor = await SessionService.getStrictActor(request);

    // =========================================================================
    // Business Logic
    // =========================================================================

    const project = await projectService.findById({
      id: projectId,

      actor: {
        id: actor.id,
        role: actor.role,
        banned: actor.banned,
      },
    });

    // =========================================================================
    // Response
    // =========================================================================

    return ApiResponse.ok(project);
  });
}

  // ===========================================================================
  // Create
  // ===========================================================================

  static async create(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getActor(request);

      if (!actor || !actor.id || !actor.role || actor.banned === undefined) {
        throw new UnauthorizedError({
          code: "unauthorized",
          message: "Failed to authenticate the actor.",
        });
      }

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      const body = await request.json();

      const data = CreateProjectSchema.parse(body);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const project = await projectService.create({
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },

        dto: data,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.created(project);
    });
  }

  // update
  static async updateProfile(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const data = UpdateProjectProfileSchema.parse(await request.json());

      // Business Logic
      const project = await projectService.updateProfile({
        id: projectId,
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        dto: data,
      });

      return ApiResponse.ok(project);
    });
  }

  static async setAsset(request: NextRequest, projectId: string, slot: string) {
    return Route.execute(async () => {
      // Validation (slot)
      if (!isProjectAssetSlot(slot)) {
        throw new ValidationError({
          code: "INVALID_ASSET_SLOT",
          status: 400,
          message: `"${slot}" is not a valid project asset slot.`,
        });
      }

      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation (body)
      const { assetId } = SetAssetSchema.parse(await request.json());

      // Business Logic
      const project = await projectService.setAsset({
        id: projectId,
        actor,
        slot,
        assetId,
      });

      return ApiResponse.ok(project);
    });
  }

  static async updateContent(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const data = UpdateProjectContentSchema.parse(await request.json());

      // Business Logic
      const project = await projectService.updateContent({
        id: projectId,
        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
        dto: data,
      });

      return ApiResponse.ok(project);
    });
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  static async delete(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getActor(request);

      if (!actor || !actor.id || !actor.role || typeof actor.banned !== "boolean") {
        throw new UnauthorizedError({
          code: "unauthorized",
          message: "Failed to authenticate the actor.",
        });
      }

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      const { id } = DeleteProjectSchema.parse({
        id: projectId,
      });

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      await projectService.delete({
        id,

        actor: {
          id: actor.id,
          role: actor.role,
          banned: actor.banned,
        },
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok({});
    });
  }

  // ===========================================================================
  // Links
  // ===========================================================================

  static async listLinks(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Business Logic
      const links = await projectLinkService.list({
        projectId,
        actor,
      });

      return ApiResponse.ok(links);
    });
  }

  static async addLink(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const dto = CreateProjectLinkSchema.parse(await request.json());

      // Business Logic
      const links = await projectLinkService.add({
        projectId,
        actor,
        dto,
      });

      return ApiResponse.ok(links);
    });
  }

  static async updateLink(
    request: NextRequest,
    projectId: string,
    linkId: string,
  ) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const dto = UpdateProjectLinkSchema.parse(await request.json());

      // Business Logic
      const links = await projectLinkService.update({
        projectId,
        linkId,
        actor,
        dto,
      });

      return ApiResponse.ok(links);
    });
  }

  static async removeLink(
    request: NextRequest,
    projectId: string,
    linkId: string,
  ) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Business Logic
      const links = await projectLinkService.remove({
        projectId,
        linkId,
        actor,
      });

      return ApiResponse.ok(links);
    });
  }

  /**
   * Reorders the project's links. Lives on the collection rather than an
   * individual link because ordering is a property of the list.
   */
  static async reorderLinks(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const dto = ReorderProjectLinksSchema.parse(await request.json());

      // Business Logic
      const links = await projectLinkService.reorder({
        projectId,
        actor,
        dto,
      });

      return ApiResponse.ok(links);
    });
  }

  // ===========================================================================
  // Testimonials
  // ===========================================================================

  static async listTestimonials(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Business Logic
      const testimonials = await projectTestimonialService.list({
        projectId,
        actor,
      });

      return ApiResponse.ok(testimonials);
    });
  }

  static async addTestimonial(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const dto = CreateProjectTestimonialSchema.parse(await request.json());

      // Business Logic
      const testimonials = await projectTestimonialService.add({
        projectId,
        actor,
        dto,
      });

      return ApiResponse.ok(testimonials);
    });
  }

  static async updateTestimonial(
    request: NextRequest,
    projectId: string,
    testimonialId: string,
  ) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const dto = UpdateProjectTestimonialSchema.parse(await request.json());

      // Business Logic
      const testimonials = await projectTestimonialService.update({
        projectId,
        testimonialId,
        actor,
        dto,
      });

      return ApiResponse.ok(testimonials);
    });
  }

  static async removeTestimonial(
    request: NextRequest,
    projectId: string,
    testimonialId: string,
  ) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Business Logic
      const testimonials = await projectTestimonialService.remove({
        projectId,
        testimonialId,
        actor,
      });

      return ApiResponse.ok(testimonials);
    });
  }

  /**
   * Reorders the project's testimonials. Lives on the collection rather than
   * an individual testimonial because ordering is a property of the list.
   */
  static async reorderTestimonials(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const dto = ReorderProjectTestimonialsSchema.parse(await request.json());

      // Business Logic
      const testimonials = await projectTestimonialService.reorder({
        projectId,
        actor,
        dto,
      });

      return ApiResponse.ok(testimonials);
    });
  }

  // ===========================================================================
  // Technologies
  // ===========================================================================

  static async listTechnologies(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Business Logic
      const technologies = await projectTechnologyService.list({
        projectId,
        actor,
      });

      return ApiResponse.ok(technologies);
    });
  }

  static async attachTechnology(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const dto = AttachProjectTechnologySchema.parse(await request.json());

      // Business Logic
      const technologies = await projectTechnologyService.attach({
        projectId,
        actor,
        technologyId: dto.technologyId,
      });

      return ApiResponse.ok(technologies);
    });
  }

  static async detachTechnology(
    request: NextRequest,
    projectId: string,
    technologyId: string,
  ) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Business Logic
      const technologies = await projectTechnologyService.detach({
        projectId,
        actor,
        technologyId,
      });

      return ApiResponse.ok(technologies);
    });
  }

  /**
   * Reorders the project's technologies. Lives on the collection rather than
   * an individual technology because ordering is a property of the list.
   */
  static async reorderTechnologies(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation
      const dto = ReorderProjectTechnologiesSchema.parse(await request.json());

      // Business Logic
      const technologies = await projectTechnologyService.reorder({
        projectId,
        actor,
        dto,
      });

      return ApiResponse.ok(technologies);
    });
  }
}
