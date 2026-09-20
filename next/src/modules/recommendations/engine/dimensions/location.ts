/**
 * Recommendation Engine — Location Dimension (PURE)
 *
 * =============================================================================
 * What "location match" means in Phase 0
 * =============================================================================
 *
 * Kizunia's location domain materializes containment at ingestion:
 * `Location -> LocationSearchArea -> SearchArea`. A location's row already
 * carries a link to every `SearchArea` that contains it (see
 * `docs/architecture/domain/location.md`), which is exactly why the search
 * feature can match "competitions in Pune" without ever walking a hierarchy
 * at query time — see `modules/competitions/search/location-clause.ts`.
 *
 * This dimension reuses that same reachable-`searchAreaId` set as its
 * candidate value, and reuses the plain default set-intersection matcher
 * (`dimension.ts`) on top of it. A user's location preference value is a
 * `SearchArea.id`; a candidate MATCHes if any of its competitions' locations
 * carries a `LocationSearchArea` row pointing at that same id.
 *
 * Because expansion is encoded in the data (a Pune address's row already
 * points at "Pune", "Maharashtra", "India" if those were resolved as
 * containing areas), preferring the broad "Maharashtra" search area still
 * matches a Pune-only competition, and preferring "Pune" does not match a
 * competition that only resolved to "Maharashtra" — expansion is downward
 * only, exactly as `ND-P-10` requires, without this dimension doing any
 * hierarchy-aware work itself.
 *
 * =============================================================================
 * What this deliberately is not
 * =============================================================================
 *
 * No coordinates, no radius, no kilometers. `RecommendationCandidate` does
 * not carry latitude/longitude at all, so a distance calculation is not
 * merely unused here — it is unreachable. Introducing it later means adding
 * those fields to the candidate shape and either extending this dimension or
 * adding a new one; it does not mean rewriting the pipeline. See
 * `docs/architecture/recommendation/future.md`.
 *
 * A competition with zero locations (`searchAreaIds: []`) is MISSING, per
 * the general missing-data rule — not "online", which is a separate `mode`
 * fact this dimension does not touch.
 */
import { DimensionId, type RecommendationDimension } from "../types";
import { listDimension } from "./set-dimension";

export const locationDimension: RecommendationDimension = listDimension(
  DimensionId.LOCATION,
  (candidate) => candidate.searchAreaIds,
);
