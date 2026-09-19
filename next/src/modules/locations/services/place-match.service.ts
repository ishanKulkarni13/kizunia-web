import { PlaceResolutionStatus, type Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { resolvePlaceProvider } from "../providers";
import { PlaceResolutionRepository } from "../repository/place-resolution.repository";
import { PlaceIdSchema } from "../schemas/location-search";
import { PlaceProviderError, type PlaceIdentityDetails } from "../types/place";
import {
  EXTRACTION_VERSION,
  extractSelectedPlaceIdentities,
} from "../utils/extract-search-areas";

/** How long a cached success stays usable before it is refreshed. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * How long a permanent miss is remembered.
 *
 * Much shorter than a success. A provider id that does not resolve today may
 * be revived or re-pointed tomorrow, and the cost of being wrong is a place
 * that stays unsearchable — so this buys relief from repeated billed lookups
 * without making the miss permanent on our side.
 */
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1_000;

/** Ceiling on a single place-details lookup during a search. */
const PROVIDER_TIMEOUT_MS = 4_000;

/**
 * A ceiling on *cold* place resolutions across this instance.
 *
 * =============================================================================
 * Why the budget lives here and not on a route
 * =============================================================================
 *
 * Autocomplete is rate limited at its controller, but autocomplete is the
 * cheap half. The expensive half is this service, and it is reachable without
 * going through that controller at all: rendering `/competitions?placeId=…` is
 * an anonymous server render that calls straight through the search plan. A
 * limiter attached to one route therefore protects one route, while the spend
 * happens somewhere else entirely.
 *
 * So the budget guards the expensive operation itself, which is the only place
 * that covers every caller by construction.
 *
 * It is deliberately global rather than per-caller. Resolution is reached from
 * the resolvable-filter path, which has no request context and should not grow
 * one — threading a caller identity through the search plan would couple the
 * plan to transport concerns for the sake of a limiter. A global bucket bounds
 * provider spend absolutely, which is the actual goal.
 *
 * Crucially it is only consumed on a cache *miss*. Warm traffic never touches
 * it, so ordinary browsing is unaffected and the budget only binds when
 * something is generating novel place ids — which is precisely the abuse
 * signature it exists to stop.
 *
 * The number and window live in the policy registry now
 * (RateLimitPolicyId.PLACES_RESOLVE, in lib/rate-limit/policies.ts) — this
 * is the one place a limit number appears platform-wide — but the "global,
 * not per-caller" design and the reasoning above are unchanged.
 */

export type PlaceResolutionFailure =
  /** Transport failure, or a provider-side error. Retrying may work. */
  | "PROVIDER_UNAVAILABLE"
  /** Our own deadline elapsed before the provider answered. */
  | "PROVIDER_TIMEOUT"
  /** The provider throttled us, or our own spend budget is exhausted. */
  | "PROVIDER_RATE_LIMITED"
  /** The provider refused the id. Permanent for this id. */
  | "PLACE_NOT_FOUND"
  /** The provider answered with something unusable. */
  | "MALFORMED_RESPONSE"
  /** Kizunia's own storage was unavailable. Not the provider's fault. */
  | "STORAGE_UNAVAILABLE";

/**
 * Failures where the situation is expected to change on its own.
 *
 * Drives two policies that must agree. A transient failure may fall back to a
 * stale cached entry, because the entry was true once and probably still is.
 * A permanent or semantic failure may not: serving stale data for a place the
 * provider now refuses would present a guess as an answer.
 *
 * `STORAGE_UNAVAILABLE` is transient but has no stale entry to fall back to by
 * definition — reaching it means the read itself failed.
 */
const TRANSIENT_FAILURES: ReadonlySet<PlaceResolutionFailure> = new Set<
  PlaceResolutionFailure
>([
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "STORAGE_UNAVAILABLE",
]);

/** Whether a stale cached entry may stand in for this failure. */
export function isTransientResolutionFailure(
  reason: PlaceResolutionFailure,
): boolean {
  return TRANSIENT_FAILURES.has(reason);
}

/**
 * A place's own coordinates — the point a radius search measures from.
 *
 * Null is a legitimate, distinct outcome: the place resolved, but the provider
 * reported no coordinates for it. That is neither a failure nor an empty
 * result, and callers must not collapse it into either.
 */
export interface PlaceAnchor {
  latitude: number;
  longitude: number;
}

/**
 * The three outcomes a location search can have, kept deliberately distinct.
 *
 * `RESOLVED` with no matching areas is a *successful* search of a real place
 * that happens to have no competitions. A provider failure is not that, and
 * collapsing the two would tell a user "nothing is happening here" when the
 * truth is "we could not find out".
 */
export type PlaceResolution =
  | {
      status: "RESOLVED";
      identityKeys: string[];
      searchAreaIds: string[];
      displayName: string | null;
      /**
       * Populated only when the caller asked for it. `null` means either "not
       * requested" or "the provider has none" — a distinction the caller does
       * not need, because it only ever reads this when it asked.
       */
      anchor: PlaceAnchor | null;
    }
  | { status: "RESOLUTION_FAILED"; reason: PlaceResolutionFailure };

/**
 * In-flight lookups, so concurrent identical searches make one provider call.
 *
 * Keyed by place id **and** whether an anchor was requested. Without the second
 * half, a plain area search already in flight would satisfy a radius search
 * arriving a moment later and hand it a result with no anchor — silently
 * disabling the radius. The two requests are not interchangeable, so they do
 * not share a slot.
 */
const inFlight = new Map<string, Promise<PlaceResolution>>();

const failed = (
  reason: PlaceResolutionFailure,
): PlaceResolution => ({ status: "RESOLUTION_FAILED", reason });

/**
 * Anything carrying a coordinate pair — a cached row (`Prisma.Decimal`) or a
 * fresh provider response (plain `number`).
 */
interface CoordinateSource {
  latitude: Prisma.Decimal | number | null;
  longitude: Prisma.Decimal | number | null;
}

/**
 * Unwraps a stored coordinate into a plain number.
 *
 * `Prisma.Decimal` does not survive JSON serialization as a number, and a
 * non-finite value is not a coordinate. Both degrade to `null` rather than
 * propagating something a distance calculation would silently turn into `NaN`.
 */
function toCoordinate(value: Prisma.Decimal | number | null): number | null {
  if (value === null) {
    return null;
  }

  const numeric = typeof value === "number" ? value : value.toNumber();

  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Reads an anchor, insisting on a complete pair.
 *
 * A half-set coordinate is not a usable centre, and treating one as an anchor
 * would place a search on the equator or the prime meridian — a confidently
 * wrong answer, which is worse than admitting there is none.
 */
function toAnchor(source: CoordinateSource): PlaceAnchor | null {
  const latitude = toCoordinate(source.latitude);

  const longitude = toCoordinate(source.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

export class PlaceMatchService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Business rules
   * ✓ Repository orchestration
   * ✓ Provider resolution and caching
   * ✓ Bounding provider spend
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate users
   * ✗ Authorize users
   * ✗ Build competition queries
   */

  /**
   * Resolves a provider place into the SearchAreas a search should match.
   *
   * Runs before any query is built, because the search engine is synchronous
   * and pure — it cannot call a provider or read the database from inside a
   * filter.
   *
   * Never creates a SearchArea. Only ingestion does. Searching is a read, and
   * letting a read write would let anyone grow the table by typing.
   *
   * **Never throws.** Every failure — provider, timeout, storage, budget — is
   * returned as `RESOLUTION_FAILED` with a truthful reason, because the caller
   * is a resolvable filter whose contract forbids exceptions and whose whole
   * purpose is to distinguish "we could not find out" from "there is nothing
   * there".
   */
  static async resolve({
    placeId,
    requireAnchor = false,
  }: {
    placeId: string;
    /**
     * Whether the caller needs the place's coordinates.
     *
     * Off by default, so the ordinary area search is completely unaffected: it
     * neither requests an anchor nor re-resolves a cached row that lacks one.
     * Radius search turns it on, which is what makes the cache migration cost
     * nothing — only places someone actually asks for a radius around are
     * re-resolved, and even then at no extra provider billing.
     */
    requireAnchor?: boolean;
  }): Promise<PlaceResolution> {
    const parsed = PlaceIdSchema.safeParse(placeId);

    // Rejected for free, before any I/O. Not cached: there is nothing to
    // remember about a value that can never become valid, and caching it would
    // let a caller fill the table with junk keys.
    if (!parsed.success) {
      return failed("PLACE_NOT_FOUND");
    }

    const id = parsed.data;

    const key = `${id}:${requireAnchor ? "anchor" : "area"}`;

    const existing = inFlight.get(key);

    if (existing) {
      return existing;
    }

    const pending = this.resolveUncached({
      placeId: id,
      requireAnchor,
    }).finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, pending);

    return pending;
  }

  private static async resolveUncached({
    placeId,
    requireAnchor,
  }: {
    placeId: string;
    requireAnchor: boolean;
  }): Promise<PlaceResolution> {
    const cached = await this.readCache({ placeId, requireAnchor });

    if (cached.fresh) {
      // A fresh negative entry is the whole point of caching misses: a dead id
      // stops costing a billed lookup on every request.
      if (cached.entry.status === PlaceResolutionStatus.NOT_FOUND) {
        return failed("PLACE_NOT_FOUND");
      }

      return this.toResolved({
        identityKeys: cached.entry.identityKeys,
        displayName: cached.entry.displayName,
        anchor: requireAnchor ? toAnchor(cached.entry) : null,
      });
    }

    // "check", not "enforce": exhaustion degrades into the domain failure
    // taxonomy below (PROVIDER_RATE_LIMITED → possibly a stale cache
    // fallback) rather than throwing an HTTP-shaped RateLimitError, which
    // would be meaningless this deep in a service with no request in scope.
    // The rejection is still observable — see the rate_limit.rejected event
    // RateLimitService emits internally.
    const budget = await rateLimitService.check({
      policyId: RateLimitPolicyId.PLACES_RESOLVE,
    });

    if (!budget.allowed) {
      return this.afterFailure({
        reason: "PROVIDER_RATE_LIMITED",
        cached: cached.entry,
        placeId,
        requireAnchor,
      });
    }

    const details = await this.fetchIdentity({ placeId });

    if (details.status === "RESOLUTION_FAILED") {
      return this.afterFailure({
        reason: details.reason,
        cached: cached.entry,
        placeId,
        requireAnchor,
      });
    }

    const identityKeys = extractSelectedPlaceIdentities(details.details);

    // The successful answer is computed *before* the cache is written, and the
    // write cannot take it away. See `writeCache`.
    const resolution = await this.toResolved({
      identityKeys,
      displayName: details.details.displayName,
      anchor: requireAnchor ? toAnchor(details.details) : null,
    });

    await this.writeCache({
      placeId,
      identityKeys,
      details: details.details,
    });

    return resolution;
  }

  // ==========================================================================
  // Cache
  // ==========================================================================

  /**
   * Reads the cached resolution, treating an unreadable cache as a miss.
   *
   * A cache is an optimization, so a read failure must degrade to "resolve it
   * again" rather than failing the search. The alternative — surfacing a
   * storage error — would turn a slow database into a broken location filter.
   */
  private static async readCache({
    placeId,
    requireAnchor,
  }: {
    placeId: string;
    requireAnchor: boolean;
  }): Promise<
    | { fresh: true; entry: NonNullable<Awaited<ReturnType<typeof PlaceResolutionRepository.find>>> }
    | { fresh: false; entry: Awaited<ReturnType<typeof PlaceResolutionRepository.find>> }
  > {
    let entry: Awaited<ReturnType<typeof PlaceResolutionRepository.find>> = null;

    try {
      entry = await PlaceResolutionRepository.find({ placeId });
    } catch (error) {
      console.warn(
        `Could not read the cached resolution for place ${placeId}; treating as a miss.`,
        error,
      );

      return { fresh: false, entry: null };
    }

    if (entry === null) {
      return { fresh: false, entry: null };
    }

    // A version mismatch means the keys were produced by rules that no longer
    // match what ingestion writes, so they are worse than useless.
    if (entry.extractionVersion !== EXTRACTION_VERSION) {
      return { fresh: false, entry };
    }

    // A successful row cached before the anchor columns existed is perfectly
    // good for an area search and useless for a radius one. Rather than
    // invalidating the whole table with an EXTRACTION_VERSION bump — which
    // would re-bill every place at once — such a row is treated as stale only
    // for the callers that actually need the anchor. The cost of the migration
    // is therefore paid one place at a time, by the searches that need it, and
    // never by ordinary browsing.
    if (
      requireAnchor &&
      entry.status === PlaceResolutionStatus.RESOLVED &&
      toAnchor(entry) === null
    ) {
      return { fresh: false, entry };
    }

    const ttl =
      entry.status === PlaceResolutionStatus.NOT_FOUND
        ? NOT_FOUND_TTL_MS
        : CACHE_TTL_MS;

    const age = Date.now() - entry.resolvedAt.getTime();

    return age < ttl ? { fresh: true, entry } : { fresh: false, entry };
  }

  /**
   * Records a successful resolution, best effort.
   *
   * Deliberately swallows its own failure. By the time this runs the billed
   * provider call has already succeeded and the answer is already in hand;
   * throwing here would discard a correct result — and waste the call that
   * produced it — because an optimization could not be persisted. The failure
   * is logged rather than hidden, because a cache that never writes turns into
   * a bill that never stops.
   */
  private static async writeCache({
    placeId,
    identityKeys,
    details,
  }: {
    placeId: string;
    identityKeys: string[];
    details: PlaceIdentityDetails;
  }): Promise<void> {
    try {
      // Persisted unconditionally, not only when a radius asked for it: the
      // provider already returned the coordinates and we have already paid for
      // them, so discarding them would guarantee a second billed lookup the
      // first time anyone does ask.
      const anchor = toAnchor(details);

      await PlaceResolutionRepository.saveResolved({
        placeId,
        identityKeys,
        displayName: details.displayName,
        contextLabel: details.formattedAddress,
        latitude: anchor?.latitude ?? null,
        longitude: anchor?.longitude ?? null,
        extractionVersion: EXTRACTION_VERSION,
      });
    } catch (error) {
      console.error(
        `Resolved place ${placeId} but could not cache the result. ` +
          "The search succeeded; subsequent searches will re-resolve and re-bill.",
        error,
      );
    }
  }

  /**
   * Decides what a failed lookup should return, by failure class.
   *
   * Transient failures may fall back to a stale entry — it was true once, and
   * staleness beats an outage. Permanent and semantic failures may not: a
   * place the provider now refuses is not described by data we happen to still
   * hold, and presenting it as current would be a guess dressed as an answer.
   *
   * A permanent miss is additionally remembered, so the next request does not
   * pay for the same refusal.
   */
  private static async afterFailure({
    reason,
    cached,
    placeId,
    requireAnchor,
  }: {
    reason: PlaceResolutionFailure;
    cached: Awaited<ReturnType<typeof PlaceResolutionRepository.find>>;
    placeId: string;
    requireAnchor: boolean;
  }): Promise<PlaceResolution> {
    if (isTransientResolutionFailure(reason)) {
      if (cached && cached.status === PlaceResolutionStatus.RESOLVED) {
        // A stale row may carry no anchor. That is returned as `null` rather
        // than escalated to a failure: the area half of the answer is still
        // true, and the radius caller has its own honest way to report a
        // missing centre.
        return this.toResolved({
          identityKeys: cached.identityKeys,
          displayName: cached.displayName,
          anchor: requireAnchor ? toAnchor(cached) : null,
        });
      }

      return failed(reason);
    }

    if (reason === "PLACE_NOT_FOUND") {
      try {
        await PlaceResolutionRepository.saveNotFound({
          placeId,
          extractionVersion: EXTRACTION_VERSION,
        });
      } catch (error) {
        // Same reasoning as `writeCache`: the answer stands either way.
        console.warn(
          `Could not record a permanent miss for place ${placeId}.`,
          error,
        );
      }
    }

    return failed(reason);
  }

  // ==========================================================================
  // Lookup
  // ==========================================================================

  /**
   * Looks up which stored areas carry any of these identities.
   *
   * An empty result is a legitimate answer — the place is real, nothing is
   * stored under it — and is returned as a success, not an error.
   *
   * A failure here is Kizunia's storage, not the provider's, and says so.
   * Reporting our own database outage as `PROVIDER_UNAVAILABLE` would send
   * whoever is on call to look at the wrong system.
   */
  private static async toResolved({
    identityKeys,
    displayName,
    anchor,
  }: {
    identityKeys: string[];
    displayName: string | null;
    anchor: PlaceAnchor | null;
  }): Promise<PlaceResolution> {
    if (identityKeys.length === 0) {
      // No stored area, but possibly a perfectly good anchor: a place nothing
      // has been ingested under can still be the centre of a radius search.
      // The two halves of this answer are independent.
      return {
        status: "RESOLVED",
        identityKeys,
        searchAreaIds: [],
        displayName,
        anchor,
      };
    }

    try {
      const areas = await prisma.searchArea.findMany({
        where: { identityKey: { in: identityKeys } },
        select: { id: true },
      });

      return {
        status: "RESOLVED",
        identityKeys,
        searchAreaIds: areas.map((area) => area.id),
        displayName,
        anchor,
      };
    } catch (error) {
      console.error("Could not look up search areas for a resolved place.", error);

      return failed("STORAGE_UNAVAILABLE");
    }
  }

  /**
   * Consults the provider for identity data only.
   *
   * Calls `resolveIdentity`, never `resolveForIngestion`: search needs the
   * place's own types and address components and nothing else, and the
   * ingestion path issues additional billed lookups to verify containment that
   * this path would immediately discard.
   */
  private static async fetchIdentity({ placeId }: { placeId: string }): Promise<
    | { status: "OK"; details: PlaceIdentityDetails }
    | { status: "RESOLUTION_FAILED"; reason: PlaceResolutionFailure }
  > {
    const provider = resolvePlaceProvider();

    if (!provider) {
      return { status: "RESOLUTION_FAILED", reason: "PROVIDER_UNAVAILABLE" };
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    try {
      const details = await provider.resolveIdentity({
        placeId,
        signal: controller.signal,
      });

      return { status: "OK", details };
    } catch (error) {
      return {
        status: "RESOLUTION_FAILED",
        reason: this.classify(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Maps a provider error onto a reason the caller can act on.
   *
   * Reads the provider's own classification rather than pattern-matching a
   * message, so a 429 stays distinguishable from a 500. That distinction is
   * operational: one means slow down, the other means something is broken, and
   * an unexpected error is not quietly relabelled as either.
   */
  private static classify(error: unknown): PlaceResolutionFailure {
    // Our own deadline, not the provider's failure.
    if (error instanceof Error && error.name === "AbortError") {
      return "PROVIDER_TIMEOUT";
    }

    if (error instanceof PlaceProviderError) {
      switch (error.kind) {
        case "NOT_FOUND":
          return "PLACE_NOT_FOUND";

        case "RATE_LIMITED":
          return "PROVIDER_RATE_LIMITED";

        case "MALFORMED":
          return "MALFORMED_RESPONSE";

        case "UNAVAILABLE":
          return "PROVIDER_UNAVAILABLE";
      }
    }

    console.error("Unclassified place provider failure.", error);

    return "PROVIDER_UNAVAILABLE";
  }
}
