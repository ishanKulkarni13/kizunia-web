import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { SearchAreaRepository } from "../repository/search-area.repository";
import type { PlaceDetails, SearchAreaCandidate } from "../types/place";
import { extractSearchAreaCandidates } from "../utils/extract-search-areas";

export class SearchAreaService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Business rules
   * ✓ Repository orchestration
   * ✓ Candidate persistence
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate users
   * ✗ Authorize users
   * ✗ Query Prisma directly
   * ✗ Call external providers
   */

  /**
   * Persists a location's discovery paths.
   *
   * This is the only place SearchAreas are created. Searching never creates
   * one: a read that writes would let anyone grow the table by typing, and an
   * area nothing is linked to can only ever return nothing.
   *
   * Candidates are extracted before this is called, outside any transaction, so
   * nothing here depends on a provider being reachable.
   *
   * Runs sequentially rather than in parallel — an interactive transaction
   * holds a single connection, so concurrent writes on `tx` contend for it.
   */
  static async linkCandidates(
    locationId: string,
    candidates: readonly SearchAreaCandidate[],
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    for (const candidate of candidates) {
      const searchArea = await SearchAreaRepository.upsertByIdentity(
        candidate,
        db,
      );

      await SearchAreaRepository.link(
        {
          locationId,
          searchAreaId: searchArea.id,
          relation: candidate.relation,
          source: candidate.source,
        },
        db,
      );
    }

    return candidates.length;
  }

  /**
   * Replaces a location's discovery paths.
   *
   * Deletes first: a location that moved from one city to another has to stop
   * being discoverable through the old one, and leaving stale links would keep
   * it findable somewhere it no longer is.
   *
   * The SearchArea rows themselves are deliberately left in place. Another
   * competition may still point at them, and even if none does, keeping the row
   * costs nothing and saves recreating it the next time somewhere in that area
   * is ingested.
   */
  static async relinkCandidates(
    locationId: string,
    candidates: readonly SearchAreaCandidate[],
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    await db.locationSearchArea.deleteMany({ where: { locationId } });

    return this.linkCandidates(locationId, candidates, db);
  }

  /**
   * Convenience for callers that hold resolved provider details.
   *
   * Extraction is pure, so this stays safe to call inside a transaction — but
   * prefer extracting before opening one, so the provider call that produced
   * `details` is nowhere near it.
   */
  static async linkFromPlaceDetails(
    locationId: string,
    details: PlaceDetails,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number> {
    return this.linkCandidates(
      locationId,
      extractSearchAreaCandidates(details),
      db,
    );
  }
}
