import { HttpClient } from "@/lib/http/client";

import type { PlaceSuggestion } from "../types/place";
import type { SearchAreaDTO } from "../types/search-area.dto";

interface PlaceAutocompleteResult {
  suggestions: PlaceSuggestion[];

  /**
   * `false` means the lookup was skipped or failed. Not an error — the caller
   * should fall back to manual entry rather than surfacing a failure.
   */
  providerAvailable: boolean;
}

export class LocationApi {
  /**
   * Place autocomplete for the admin editor. Hits the external provider.
   */
  static async autocomplete(
    query: string,
    options: { limit?: number; sessionToken?: string } = {},
  ): Promise<PlaceAutocompleteResult> {
    const params = new URLSearchParams({
      q: query,
      limit: String(options.limit ?? 10),
      ...(options.sessionToken && { sessionToken: options.sessionToken }),
    });

    // The public endpoint, so the same picker works for an anonymous visitor
    // filtering competitions and for an admin attaching one.
    const response = await HttpClient.get<PlaceAutocompleteResult>(
      `/api/v1/places/autocomplete?${params.toString()}`,
    );

    return response.data;
  }

  /**
   * Typeahead over search areas the platform already knows about, for the
   * competition location filter. Reads Kizunia's own rows — no provider call.
   */
  static async searchAreas(query: string, limit = 10): Promise<SearchAreaDTO[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });

    const response = await HttpClient.get<SearchAreaDTO[]>(
      `/api/v1/search-areas?${params.toString()}`,
    );

    return response.data;
  }
}
