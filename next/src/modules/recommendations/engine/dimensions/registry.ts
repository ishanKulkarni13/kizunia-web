/**
 * Recommendation Engine — Dimension Registry (PURE)
 *
 * The single place every Phase 0 dimension is declared. Adding a dimension
 * is: implement `extract` (and `match`, if it is not plain set
 * intersection), add one entry here, and add one system weight in
 * `../../config/recommendation-config.ts`. Nothing else in the engine
 * changes — `pipeline.ts` iterates this map generically.
 *
 * Removing/disabling a dimension does not mean deleting its entry here: it
 * means excluding its id from `RecommendationConfig.enabledDimensions`. This
 * registry is "every dimension the engine is capable of evaluating"; the
 * config decides which of them are actually turned on.
 */
import { DimensionId, type RecommendationDimension } from "../types";
import { locationDimension } from "./location";
import { listDimension, scalarDimension } from "./set-dimension";
import { teamSizeDimension } from "./team-size";

export const COMPETITION_DIMENSIONS: ReadonlyMap<
  DimensionId,
  RecommendationDimension
> = new Map(
  [
    scalarDimension(DimensionId.MODE, (c) => c.mode),
    listDimension(DimensionId.CATEGORIES, (c) => c.categorySlugs),
    listDimension(DimensionId.TECHNOLOGIES, (c) => c.technologySlugs),
    listDimension(DimensionId.ELIGIBILITIES, (c) => c.eligibilityTypes),
    locationDimension,
    scalarDimension(DimensionId.REGISTRATION_PLATFORM, (c) => c.registrationPlatform),
    scalarDimension(DimensionId.REGISTRATION_TYPE, (c) => c.registrationType),
    scalarDimension(DimensionId.REGISTRATION_FEE_TYPE, (c) => c.registrationFeeType),
    scalarDimension(DimensionId.ORGANIZER_TYPE, (c) => c.organizerType),
    scalarDimension(DimensionId.DIFFICULTY, (c) => c.difficulty),
    scalarDimension(DimensionId.CERTIFICATE_TYPE, (c) => c.certificateType),
    scalarDimension(DimensionId.STATUS, (c) => c.status),
    teamSizeDimension,
  ].map((dimension) => [dimension.id, dimension] as const),
);
