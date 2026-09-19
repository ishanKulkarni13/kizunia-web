import type { PlaceProvider } from "../types/place";
import { GooglePlaceProvider } from "./google.provider";

/**
 * Resolves the configured place provider, or `null` when none is set up.
 *
 * `null` is a supported state, not a misconfiguration. Without a provider an
 * admin can still enter a location manually and the competition saves normally;
 * only discovery is narrower, because a manually-typed place yields no verified
 * containment and therefore only its own SearchArea.
 *
 * Environment
 * -----------
 * GOOGLE_MAPS_API_KEY   Server-side key. Never expose via NEXT_PUBLIC_.
 * GOOGLE_PLACES_BASE_URL Override for testing against a stub.
 */
export function resolvePlaceProvider(): PlaceProvider | null {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const baseUrl = process.env.GOOGLE_PLACES_BASE_URL?.trim();

  return baseUrl
    ? new GooglePlaceProvider(apiKey, baseUrl)
    : new GooglePlaceProvider(apiKey);
}

export { GooglePlaceProvider };
