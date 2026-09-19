/**
 * Locations Module - Controller
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

import { resolvePlaceProvider } from "../providers";
import { PlaceAutocompleteQuerySchema } from "../schemas/location-search";
import type { PlaceSuggestion } from "../types/place";

/**
 * How long the provider gets before autocomplete gives up on it.
 *
 * Short on purpose: an admin waiting on a picker would rather be told to type
 * the place manually than watch a spinner.
 */
const PROVIDER_TIMEOUT_MS = 3_000;

export class LocationController {
  /**
   * Place autocomplete for the competition editor.
   *
   * Authenticated because it fronts a billed provider — an open endpoint would
   * let anyone spend the project's Places quota.
   *
   * Never fails because of the provider. An unconfigured or unreachable Google
   * returns an empty list with `providerAvailable: false`, which the picker
   * reads as "offer manual entry", so a provider outage can still never block
   * saving a competition.
   */
  static async autocomplete(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------

      await SessionService.getActor(request);

      // -----------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------

      const query = Object.fromEntries(request.nextUrl.searchParams.entries());

      const { q, limit, sessionToken } =
        PlaceAutocompleteQuerySchema.parse(query);

      // -----------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------

      const provider = resolvePlaceProvider();

      if (!provider) {
        return ApiResponse.ok({
          suggestions: [] as PlaceSuggestion[],
          providerAvailable: false,
        });
      }

      const controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        PROVIDER_TIMEOUT_MS,
      );

      try {
        const suggestions = await provider.autocomplete({
          query: q,
          limit,
          signal: controller.signal,
          sessionToken,
        });

        return ApiResponse.ok({
          suggestions,
          providerAvailable: true,
        });
      } catch (error) {
        console.warn(
          `Place provider "${provider.name}" autocomplete failed; falling back to manual entry.`,
          error,
        );

        return ApiResponse.ok({
          suggestions: [] as PlaceSuggestion[],
          providerAvailable: false,
        });
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}
