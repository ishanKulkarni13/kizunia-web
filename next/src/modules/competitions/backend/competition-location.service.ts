import { HttpStatus, ValidationError } from "@/lib/errors";
import prisma from "@/lib/prisma";
import {
  LocationRepository,
  LocationService,
  SearchAreaService,
  extractSearchAreaCandidates,
  placeDetailsToLocationInput,
  resolvePlaceProvider,
  type LocationInput,
  type PlaceDetails,
} from "@/modules/locations";

import { CompetitionErrorCode } from "../errors/error-code";
import type {
  CreateCompetitionLocationInput,
  ReorderCompetitionLocationsInput,
  UpdateCompetitionLocationInput,
} from "../schemas/competition-location";
import type { CompetitionLocationDTO } from "../types/competition-location.dto";
import { competitionLocationMapper } from "./competition-location.mapper";
import { CompetitionLocationRepository } from "./competition-location.repository";

/**
 * Upper bound on locations per competition.
 *
 * Not a product rule so much as a guard: a multi-city competition realistically
 * tops out in the low dozens, and an unbounded list would let one competition
 * degrade every query that loads locations.
 */
const MAX_LOCATIONS_PER_COMPETITION = 50;

/** Ceiling on a single place-details resolve during ingestion. */
const PROVIDER_TIMEOUT_MS = 5_000;

export class CompetitionLocationService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Business rules
   * ✓ Repository orchestration
   * ✓ Domain validation
   * ✓ Mapping database models
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate users
   * ✗ Authorize users
   * ✗ Query Prisma directly
   * ✗ Return NextResponse
   *
   * Mutations return the competition's full location list so the editor always
   * reflects server-assigned ordering rather than guessing at it locally.
   */
  static async list(competitionId: string): Promise<CompetitionLocationDTO[]> {
    const locations =
      await CompetitionLocationRepository.findManyByCompetition(competitionId);

    return competitionLocationMapper.toDTOs(locations);
  }

  /**
   * Attaches a new place to a competition.
   *
   * The Location row and the link are created together: a Location with no
   * competition pointing at it is unreachable, so a partial failure would leak
   * an orphan row.
   */
  static async add(
    competitionId: string,
    input: CreateCompetitionLocationInput,
  ): Promise<CompetitionLocationDTO[]> {
    // ----------------------------------------------------------------
    // External phase — no transaction is open
    // ----------------------------------------------------------------
    //
    // The provider call happens first, on its own. Holding a database
    // transaction open across a network request ties a connection up for the
    // duration and puts the whole write at the mercy of the transaction
    // timeout, which is the same order of magnitude as the provider's own.
    // Nothing here needs to be atomic with the writes below.

    const resolved = await this.resolveSource(input);

    const candidates = resolved.details
      ? extractSearchAreaCandidates(resolved.details)
      : [];

    // ----------------------------------------------------------------
    // Database phase
    // ----------------------------------------------------------------

    await prisma.$transaction(async (tx) => {
      const existing = await CompetitionLocationRepository.countForCompetition(
        competitionId,
        tx,
      );

      if (existing >= MAX_LOCATIONS_PER_COMPETITION) {
        throw new ValidationError({
          code: CompetitionErrorCode.LOCATION_LIMIT_REACHED,
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message: `A competition cannot have more than ${MAX_LOCATIONS_PER_COMPETITION} locations.`,
        });
      }

      const location = await LocationService.create(resolved.locationInput, tx);

      // Discovery paths come only from provider evidence. A manually typed
      // location saves normally but earns none — with nothing verifying where
      // it is, any area we recorded would be a guess, and a guess here makes a
      // competition discoverable somewhere it may not be.
      await SearchAreaService.linkCandidates(location.id, candidates, tx);

      const order = await CompetitionLocationRepository.nextOrder(
        competitionId,
        tx,
      );

      await CompetitionLocationRepository.create(
        {
          competitionId,

          locationId: location.id,

          label: input.label ?? null,

          venueName: input.venueName ?? null,

          address: input.address ?? null,

          startDate: input.startDate ?? null,

          endDate: input.endDate ?? null,

          order,
        },
        tx,
      );
    });

    return this.list(competitionId);
  }

  /**
   * Updates how a competition uses a location, and optionally the place itself.
   *
   * Because locations are private to one competition, replacing the place
   * rewrites the existing Location row in place rather than creating a second
   * one — there is no other competition that could be affected.
   */
  static async update(
    competitionId: string,
    competitionLocationId: string,
    input: UpdateCompetitionLocationInput,
  ): Promise<CompetitionLocationDTO[]> {
    // External phase first, for the same reason as `add()`.
    const replacing = Boolean(input.providerPlaceId || input.location);

    const resolved = replacing ? await this.resolveSource(input) : null;

    const candidates = resolved?.details
      ? extractSearchAreaCandidates(resolved.details)
      : [];

    await prisma.$transaction(async (tx) => {
      const existing =
        await CompetitionLocationRepository.findByIdForCompetitionOrThrow(
          competitionId,
          competitionLocationId,
          tx,
        );

      // Replacing the place must also replace its discovery paths: a location
      // moved from Pune to Mumbai has to stop being discoverable through Pune.
      if (resolved) {
        await LocationService.update(
          existing.locationId,
          resolved.locationInput,
          tx,
        );

        await SearchAreaService.relinkCandidates(
          existing.locationId,
          candidates,
          tx,
        );
      }

      await CompetitionLocationRepository.update(
        competitionLocationId,
        {
          // `undefined` leaves a column untouched; `null` clears it. Spreading
          // conditionally keeps a PATCH that omits a field from wiping it.
          ...(input.label !== undefined && { label: input.label }),

          ...(input.venueName !== undefined && { venueName: input.venueName }),

          ...(input.address !== undefined && { address: input.address }),

          ...(input.startDate !== undefined && { startDate: input.startDate }),

          ...(input.endDate !== undefined && { endDate: input.endDate }),
        },
        tx,
      );
    });

    return this.list(competitionId);
  }

  /**
   * Detaches a location and deletes the underlying place if nothing else
   * references it — which, given locations are never shared, is the norm.
   */
  static async remove(
    competitionId: string,
    competitionLocationId: string,
  ): Promise<CompetitionLocationDTO[]> {
    await prisma.$transaction(async (tx) => {
      const existing =
        await CompetitionLocationRepository.findByIdForCompetitionOrThrow(
          competitionId,
          competitionLocationId,
          tx,
        );

      await CompetitionLocationRepository.delete(competitionLocationId, tx);

      await LocationRepository.deleteIfOrphaned(existing.locationId, tx);
    });

    return this.list(competitionId);
  }

  /**
   * Rewrites presentation order from a full list of ids.
   *
   * The request must name every location exactly once. A partial list would
   * leave the remainder at stale positions, producing duplicate orders and a
   * list whose displayed sequence depends on tie-breaking rather than intent.
   */
  static async reorder(
    competitionId: string,
    input: ReorderCompetitionLocationsInput,
  ): Promise<CompetitionLocationDTO[]> {
    await prisma.$transaction(async (tx) => {
      const owned = await CompetitionLocationRepository.findIdsForCompetition(
        competitionId,
        tx,
      );

      this.assertCoversAll(owned, input.ids);

      // Sequential rather than Promise.all: an interactive transaction runs on
      // a single connection, so parallel queries against `tx` contend for it.
      for (const [index, id] of input.ids.entries()) {
        await CompetitionLocationRepository.update(
          id,
          {
            order: index,
          },
          tx,
        );
      }
    });

    return this.list(competitionId);
  }

  /**
   * Turns either ingestion path into the same shape.
   *
   * A selected place is resolved against the provider once, here, and the
   * result is copied into Location fields — after which the competition holds
   * no dependency on the provider at all.
   *
   * A provider failure on a selected place is surfaced rather than swallowed:
   * the admin explicitly chose a place, and silently saving something less than
   * they picked would be worse than telling them to retry or type it manually.
   */
  private static async resolveSource(input: {
    providerPlaceId?: string;
    location?: LocationInput;
  }): Promise<{ locationInput: LocationInput; details: PlaceDetails | null }> {
    if (!input.providerPlaceId) {
      if (!input.location) {
        throw new ValidationError({
          code: CompetitionErrorCode.LOCATION_SOURCE_MISSING,
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message: "Either a selected place or a manual location is required.",
        });
      }

      return { locationInput: input.location, details: null };
    }

    const provider = resolvePlaceProvider();

    if (!provider) {
      throw new ValidationError({
        code: CompetitionErrorCode.LOCATION_PROVIDER_UNAVAILABLE,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message:
          "Place lookup is not configured. Enter the location manually instead.",
      });
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    try {
      // The ingestion path deliberately: it is what verifies containment, and
      // those discovery paths are written once here and then read by every
      // subsequent search. Competition search uses `resolveIdentity` instead.
      const details = await provider.resolveForIngestion({
        placeId: input.providerPlaceId,
        signal: controller.signal,
      });

      return {
        locationInput: placeDetailsToLocationInput(details, provider.name),
        details,
      };
    } catch (error) {
      throw new ValidationError({
        code: CompetitionErrorCode.LOCATION_PROVIDER_UNAVAILABLE,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message:
          "Could not resolve the selected place. Try again, or enter the location manually.",
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  // ==========================================================================
  // Business Validation
  // ==========================================================================

  private static assertCoversAll(owned: string[], provided: string[]): void {
    const ownedSet = new Set(owned);

    const providedSet = new Set(provided);

    const isExactCover =
      providedSet.size === provided.length &&
      providedSet.size === ownedSet.size &&
      provided.every((id) => ownedSet.has(id));

    if (!isExactCover) {
      throw new ValidationError({
        code: CompetitionErrorCode.LOCATION_REORDER_MISMATCH,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message:
          "Reorder must list every location of this competition exactly once.",
      });
    }
  }
}
