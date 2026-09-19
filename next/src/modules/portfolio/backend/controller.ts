/**
 * Portfolio Module - Controller
 *
 * Responsible for:
 *
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

import { SessionService } from "@/lib/auth/session";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { portfolioService } from "./service";
import { portfolioProjectService } from "./portfolio-project.service";
import { portfolioTestimonialService } from "./portfolio-testimonial.service";
import { portfolioTechnologyService } from "./portfolio-technology.service";



import { createPortfolioSchema } from "../schemas";
import { PortfolioNotFoundError } from "../errors";
import { UpdatePortfolioProfileSchema } from "../schemas/update/profile-update.schema";
import {
  AddPortfolioTestimonialSchema,
  ReorderPortfolioTestimonialsSchema,
  UpdatePortfolioTestimonialSchema,
} from "../schemas/portfolio-testimonial.schema";
import {
  AddPortfolioProjectSchema,
  ReorderPortfolioProjectsSchema,
  UpdatePortfolioProjectSchema,
} from "../schemas/portfolio-project.schema";
import {
  AddPortfolioTechnologySchema,
  ReorderPortfolioTechnologiesSchema,
  UpdatePortfolioTechnologySchema,
} from "../schemas/portfolio-technology.schema";

export class PortfolioController {
  // ===========================================================================
  // Read
  // ===========================================================================

  static async findPublicByUsername(
    request: NextRequest,
    username: string,
  ) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Rate Limiting
      // -----------------------------------------------------------------------
      // Public, unauthenticated. Guards against enumeration/scraping of a
      // full portfolio aggregate.

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.PORTFOLIO_READ_PUBLIC,
        request,
      });

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const portfolio =
        await portfolioService.findPublicByUsername({
          username,
        });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(portfolio);
    });
  }

  static async findMine(request: NextRequest) {
  return Route.execute(async () => {
    // -----------------------------------------------------------------------
    // Authentication
    // -----------------------------------------------------------------------

    const actor = await SessionService.getActor(request);

    if (
      !actor ||
      !actor.id ||
      !actor.role ||
      actor.banned === undefined
    ) {
      throw new UnauthorizedError({
        code: "UNAUTHORIZED",
        message: "Failed to authenticate the actor.",
      });
    }

    // -----------------------------------------------------------------------
    // Business Logic
    // -----------------------------------------------------------------------

    const portfolio = await portfolioService.findMine({
      actor: {
        id: actor.id,
        role: actor.role,
        banned: ( actor.banned === true) ? true : false,
      },
    });

    if (!portfolio) {
      throw new PortfolioNotFoundError();
    }

    // -----------------------------------------------------------------------
    // Response
    // -----------------------------------------------------------------------

    return ApiResponse.ok(portfolio);
  });
}

  // ===========================================================================
  // Create
  // ===========================================================================

  static async create(
    request: NextRequest,
  ) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor =
        await SessionService.getActor(request);

      if (
        !actor ||
        !actor.id ||
        !actor.role ||
        actor.banned === undefined
      ) {
        throw new UnauthorizedError({
          code: "UNAUTHORIZED",
          message:
            "Failed to authenticate the actor.",
        });
      }

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      // const body =
      //   await request.json();

      // const dto =
      //   createPortfolioSchema.parse(body);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const portfolio =
        await portfolioService.create({
          actor: {
            id: actor.id,
            role: actor.role,
            banned: (actor.banned === true) ? true : false,
          },

          // dto,
        });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.created(
        portfolio,
      );
    });
  }

  // ===========================================================================
// Profile
// ===========================================================================

static async updateProfile(request: NextRequest) {
  return Route.execute(async () => {
    // -----------------------------------------------------------------------
    // Authentication
    // -----------------------------------------------------------------------

    const actor = await SessionService.getStrictActor(request);

    // if (
    //   !actor ||
    //   !actor.id ||
    //   !actor.role ||
    //   actor.banned === undefined
    // ) {
    //   throw new UnauthorizedError({
    //     code: "unauthorized",
    //     message: "Failed to authenticate the actor.",
    //   });
    // }

    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------

    const body = await request.json();

    const data = UpdatePortfolioProfileSchema.parse(body);

    // -----------------------------------------------------------------------
    // Business Logic
    // -----------------------------------------------------------------------

    const portfolio = await portfolioService.updateProfile({
      actor: {
        id: actor.id,
        role: actor.role,
        banned: (actor.banned === true) ? true : false,
      },

      dto: data,
    });

    // -----------------------------------------------------------------------
    // Response
    // -----------------------------------------------------------------------

    return ApiResponse.ok(portfolio);
  });
}

  // ===========================================================================
  // Projects
  //
  // No handler accepts a portfolio id: the portfolio is always derived from
  // the session, matching `updateProfile` above. Every mutation returns the
  // resulting list so the editor never has to re-derive server ordering.
  // ===========================================================================

  static async listProjects(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const projects = await portfolioProjectService.list({ actor });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(projects);
    });
  }

  static async addProject(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      const body = await request.json();

      const dto = AddPortfolioProjectSchema.parse(body);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const projects = await portfolioProjectService.add({ actor, dto });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.created(projects);
    });
  }

  static async reorderProjects(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      const body = await request.json();

      const dto = ReorderPortfolioProjectsSchema.parse(body);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const projects = await portfolioProjectService.reorder({ actor, dto });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(projects);
    });
  }

  static async updateProject(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------------

      const body = await request.json();

      const dto = UpdatePortfolioProjectSchema.parse(body);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const projects = await portfolioProjectService.setFeatured({
        actor,
        projectId,
        dto,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(projects);
    });
  }

  static async removeProject(request: NextRequest, projectId: string) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------------

      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------------

      const projects = await portfolioProjectService.remove({
        actor,
        projectId,
      });

      // -----------------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------------

      return ApiResponse.ok(projects);
    });
  }

  // ===========================================================================
  // Testimonials
  //
  // No handler accepts a portfolio id: the portfolio is always derived from
  // the session, matching Projects above. Every mutation returns the
  // resulting list so the editor never has to re-derive server ordering.
  // ===========================================================================

  static async listTestimonials(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const testimonials = await portfolioTestimonialService.list({ actor });

      return ApiResponse.ok(testimonials);
    });
  }

  static async addTestimonial(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const body = await request.json();

      const dto = AddPortfolioTestimonialSchema.parse(body);

      const testimonials = await portfolioTestimonialService.add({
        actor,
        dto,
      });

      return ApiResponse.created(testimonials);
    });
  }

  static async reorderTestimonials(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const body = await request.json();

      const dto = ReorderPortfolioTestimonialsSchema.parse(body);

      const testimonials = await portfolioTestimonialService.reorder({
        actor,
        dto,
      });

      return ApiResponse.ok(testimonials);
    });
  }

  static async updateTestimonial(
    request: NextRequest,
    testimonialId: string,
  ) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const body = await request.json();

      const dto = UpdatePortfolioTestimonialSchema.parse(body);

      const testimonials = await portfolioTestimonialService.update({
        actor,
        testimonialId,
        dto,
      });

      return ApiResponse.ok(testimonials);
    });
  }

  static async removeTestimonial(
    request: NextRequest,
    testimonialId: string,
  ) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const testimonials = await portfolioTestimonialService.remove({
        actor,
        testimonialId,
      });

      return ApiResponse.ok(testimonials);
    });
  }

  // ===========================================================================
  // Technologies
  //
  // No handler accepts a portfolio id: the portfolio is always derived from
  // the session, matching Projects/Testimonials above. Every mutation
  // returns the resulting list so the editor never has to re-derive server
  // ordering.
  // ===========================================================================

  static async listTechnologies(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const technologies = await portfolioTechnologyService.list({ actor });

      return ApiResponse.ok(technologies);
    });
  }

  static async addTechnology(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const body = await request.json();

      const dto = AddPortfolioTechnologySchema.parse(body);

      const technologies = await portfolioTechnologyService.add({
        actor,
        dto,
      });

      return ApiResponse.created(technologies);
    });
  }

  static async reorderTechnologies(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const body = await request.json();

      const dto = ReorderPortfolioTechnologiesSchema.parse(body);

      const technologies = await portfolioTechnologyService.reorder({
        actor,
        dto,
      });

      return ApiResponse.ok(technologies);
    });
  }

  static async updateTechnology(request: NextRequest, technologyId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const body = await request.json();

      const dto = UpdatePortfolioTechnologySchema.parse(body);

      const technologies = await portfolioTechnologyService.updateMetadata({
        actor,
        technologyId,
        dto,
      });

      return ApiResponse.ok(technologies);
    });
  }

  static async removeTechnology(request: NextRequest, technologyId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const technologies = await portfolioTechnologyService.remove({
        actor,
        technologyId,
      });

      return ApiResponse.ok(technologies);
    });
  }
}