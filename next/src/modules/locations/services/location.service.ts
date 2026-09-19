import type { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { LocationRepository } from "../repository/location.repository";
import type { LocationInput } from "../schemas/location-input";
import { normalizeLocationInput } from "../utils/normalize";

export class LocationService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Business rules
   * ✓ Repository orchestration
   * ✓ Normalization
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate users
   * ✗ Authorize users
   * ✗ Query Prisma directly
   */

  /**
   * Creates a location owned by a single competition.
   *
   * Never reuses an existing row, even for an identical place. Sharing rows
   * would make editing one competition's venue silently rewrite another's, and
   * deciding whether two entries are "the same place" is exactly the fuzzy
   * matching problem this design avoids.
   */
  static async create(
    input: LocationInput,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return LocationRepository.create(normalizeLocationInput(input), db);
  }

  static async update(
    id: string,
    input: LocationInput,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return LocationRepository.update(id, normalizeLocationInput(input), db);
  }
}
