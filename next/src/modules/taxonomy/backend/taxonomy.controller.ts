/**
 * Taxonomy Module - Controller
 *
 * Responsible for:
 * - Request parsing
 * - Rate limiting
 * - Calling services
 * - Returning responses
 *
 * Controllers should never contain business logic.
 */

import { NextRequest } from "next/server";

import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { TaxonomyQuerySchema } from "../schemas/taxonomy-query";
import { TaxonomyService } from "../services/taxonomy.service";

export class TaxonomyController {
  static async categories(request: NextRequest) {
    return this.list(
      request,
      RateLimitPolicyId.TAXONOMY_CATEGORIES,
      (query) => TaxonomyService.listCategories(query),
    );
  }

  static async technologies(request: NextRequest) {
    return this.list(
      request,
      RateLimitPolicyId.TAXONOMY_TECHNOLOGIES,
      (query) => TaxonomyService.listTechnologies(query),
    );
  }

  /**
   * Shared handling for both lists.
   *
   * Written once because the two differ only in which service call (and
   * which rate-limit policy) they use; duplicating the parsing would create
   * two places for the public-endpoint protections to drift apart. The two
   * still enforce separate budgets — see taxonomy:categories vs
   * taxonomy:technologies in the policy registry — so one endpoint cannot
   * starve the other's allowance.
   */
  private static async list(
    request: NextRequest,
    policyId: RateLimitPolicyId,
    load: (
      query: ReturnType<typeof TaxonomyQuerySchema.parse>,
    ) => Promise<unknown>,
  ) {
    return Route.execute(async () => {
      await rateLimitService.enforce({ policyId, request });

      const raw = Object.fromEntries(request.nextUrl.searchParams.entries());

      const query = TaxonomyQuerySchema.parse(raw);

      return ApiResponse.ok(await load(query));
    });
  }
}
