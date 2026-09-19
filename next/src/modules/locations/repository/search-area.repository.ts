import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import type { SearchAreaCandidate } from "../types/place";

export class SearchAreaRepository {
  /**
   * Database Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Build Prisma queries
   * ✓ Execute database operations
   * ✓ Return Prisma models
   *
   * Does NOT
   * ----------------
   * ✗ Business rules
   * ✗ Authentication
   * ✗ Authorization
   * ✗ DTO Mapping
   */

  /**
   * Resolves a candidate to a stored SearchArea, creating it only if new.
   *
   * Upsert on `identityKey` rather than find-then-create: two competitions in
   * the same city can be ingested concurrently, and the unique constraint is
   * what actually decides the race. The update branch refreshes display fields
   * so a later, better-described sighting of the same entity improves the row
   * without ever forking it.
   */
  static async upsertByIdentity(
    candidate: SearchAreaCandidate,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.searchArea.upsert({
      where: {
        identityKey: candidate.identityKey,
      },

      create: {
        identityKey: candidate.identityKey,
        displayName: candidate.displayName,
        providerKind: candidate.providerKind,
        contextLabel: candidate.contextLabel,
        provider: candidate.provider,
        providerLocationId: candidate.providerLocationId,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
      },

      update: {
        displayName: candidate.displayName,
        providerKind: candidate.providerKind,
        contextLabel: candidate.contextLabel,

        // Only ever fill these in, never blank them: a candidate arriving from
        // a weaker source has less provider data, and letting it overwrite would
        // downgrade an entity that was already well identified.
        ...(candidate.provider && { provider: candidate.provider }),
        ...(candidate.providerLocationId && {
          providerLocationId: candidate.providerLocationId,
        }),
        ...(candidate.latitude !== null && { latitude: candidate.latitude }),
        ...(candidate.longitude !== null && { longitude: candidate.longitude }),
      },
    });
  }

  /**
   * Links a location to a search area.
   *
   * Idempotent: re-ingesting the same place must not fail on the composite key.
   */
  static async link(
    params: {
      locationId: string;
      searchAreaId: string;
      relation: Prisma.LocationSearchAreaCreateManyInput["relation"];
      source: Prisma.LocationSearchAreaCreateManyInput["source"];
    },
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.locationSearchArea.upsert({
      where: {
        locationId_searchAreaId: {
          locationId: params.locationId,
          searchAreaId: params.searchAreaId,
        },
      },

      create: params,

      update: {
        relation: params.relation,
        source: params.source,
      },
    });
  }

  /**
   * Typeahead over search areas the platform actually knows about.
   *
   * Deliberately internal-only — no provider call. Offering a place no
   * competition is linked to could only ever return zero results, so the filter
   * should not be able to suggest one.
   */
  static async search(query: string, limit: number) {
    return prisma.searchArea.findMany({
      where: {
        displayName: {
          contains: query,
          mode: "insensitive",
        },

        // A search area with no locations is unreachable and would be a dead
        // filter option.
        locations: {
          some: {},
        },
      },

      orderBy: {
        displayName: "asc",
      },

      take: limit,
    });
  }
}
