export { LocationService } from "./services/location.service";
export { SearchAreaService } from "./services/search-area.service";
export {
  PlaceMatchService,
  isTransientResolutionFailure,
  type PlaceAnchor,
  type PlaceResolution,
  type PlaceResolutionFailure,
} from "./services/place-match.service";

export { LocationRepository } from "./repository/location.repository";
export { SearchAreaRepository } from "./repository/search-area.repository";
export { PlaceResolutionRepository } from "./repository/place-resolution.repository";

export { LocationMapper, locationMapper } from "./mapper/location.mapper";
export { SearchAreaMapper, searchAreaMapper } from "./mapper/search-area.mapper";

export { LocationInputSchema, type LocationInput } from "./schemas/location-input";
export {
  PlaceAutocompleteQuerySchema,
  PlaceIdSchema,
  SearchAreaQuerySchema,
  type PlaceAutocompleteQuery,
  type SearchAreaQuery,
} from "./schemas/location-search";

export type { LocationDTO } from "./types/location.dto";
export type { SearchAreaDTO } from "./types/search-area.dto";
export { PlaceProviderError } from "./types/place";
export type {
  PlaceProvider,
  PlaceDetails,
  PlaceIdentityDetails,
  PlaceProviderErrorKind,
  PlaceSuggestion,
  PlaceAddressComponent,
  PlaceContainingArea,
  SearchAreaCandidate,
} from "./types/place";

export {
  inferPrecision,
  normalizeLocationInput,
  placeDetailsToLocationInput,
  type NormalizedLocation,
} from "./utils/normalize";

export {
  EXTRACTION_VERSION,
  extractSearchAreaCandidates,
  extractSelectedPlaceIdentities,
  dedupeCandidates,
} from "./utils/extract-search-areas";

export {
  buildContextLabel,
  contextualIdentityKey,
  normalizeIdentityName,
  providerIdentityKey,
} from "./utils/identity";

export { resolvePlaceProvider } from "./providers";

export {
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
  RADIUS_STEPS,
  boundingBox,
  clampRadiusKm,
  haversineKm,
  isInsideBoundingBox,
  isValidCoordinates,
  roundDeviceCoordinate,
  type BoundingBox,
  type Coordinates,
  type LongitudeRange,
} from "./utils/radius";
