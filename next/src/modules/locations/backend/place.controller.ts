/**
 * Locations Module - Public Place Controller
 *
 * Responsible for:
 * - Request parsing
 * - Rate limiting
 * - Calling providers
 * - Returning responses
 *
 * Controllers should never contain business logic.
 */

import { NextRequest } from "next/server";

import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { resolvePlaceProvider } from "../providers";
import { PlaceAutocompleteQuerySchema } from "../schemas/location-search";
import type { PlaceSuggestion } from "../types/place";

/** Short on purpose: a picker should fall back rather than hang. */
const PROVIDER_TIMEOUT_MS = 3_000;

export class PlaceController {
  /**
   * Public place autocomplete.
   *
   * Unauthenticated by necessity: a visitor filtering competitions has to be
   * able to name a place, and requiring an account to do that would gate
   * browsing behind sign-up. That makes the provider quota reachable by
   * anonymous traffic, so the limiter runs here, first, inside the request
   * path — configuring one elsewhere would not protect this route.
   *
   * Never fails because of the provider. An unconfigured or unreachable
   * provider yields an empty list with `providerAvailable: false`, which the
   * caller reads as "suggest nothing" rather than as an error.
   */
  static async autocomplete(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------
      // Rate Limiting
      // -----------------------------------------------------------------

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.PLACES_AUTOCOMPLETE,
        request,
      });

      // -----------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------

      const query = Object.fromEntries(request.nextUrl.searchParams.entries());

      const { q, limit: max, sessionToken } =
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

      const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

      try {
        const suggestions = await provider.autocomplete({
          query: q,
          limit: max,
          signal: controller.signal,
          sessionToken,
        });

        return ApiResponse.ok({ suggestions, providerAvailable: true });
      } catch (error) {
        console.warn(
          `Place provider "${provider.name}" autocomplete failed.`,
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
