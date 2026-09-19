/**
 * Locations Module - SearchArea Controller
 *
 * Responsible for:
 * - Request parsing
 * - Calling services
 * - Returning responses
 *
 * Controllers should never contain business logic.
 */

import { NextRequest } from "next/server";

import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";

import { searchAreaMapper } from "../mapper/search-area.mapper";
import { SearchAreaRepository } from "../repository/search-area.repository";
import { SearchAreaQuerySchema } from "../schemas/location-search";

export class SearchAreaController {
  /**
   * Typeahead for the competition location filter.
   *
   * Public and unauthenticated, unlike place autocomplete, because it reads
   * only Kizunia's own rows — no provider call, no billing, nothing to abuse
   * beyond ordinary querying.
   *
   * Deliberately never creates a SearchArea. Only ingestion does. A place no
   * competition is linked to could only ever return zero results, so it should
   * not be offerable as a filter in the first place.
   */
  static async search(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------

      const query = Object.fromEntries(request.nextUrl.searchParams.entries());

      const { q, limit } = SearchAreaQuerySchema.parse(query);

      // -----------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------

      const areas = await SearchAreaRepository.search(q, limit);

      // -----------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------

      return ApiResponse.ok(searchAreaMapper.toDTOs(areas));
    });
  }
}
