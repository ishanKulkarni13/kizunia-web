/**
 * Billing — Raw SQL helpers
 *
 * The claim, the mark-due write, the event and fact dedupe inserts and the
 * anomaly upsert need SQL Prisma's query API cannot express (`FOR UPDATE SKIP
 * LOCKED`, `LEAST`, `ON CONFLICT … WHERE`). They follow the hazards the
 * notification work queue documents (`modules/notifications/jobs/postgres-work-queue.ts`):
 *
 *  - `DateTime` columns are `timestamp(3) without time zone` holding UTC, so a
 *    bound `Date` is converted explicitly (`utc`), never left to the session
 *    time zone;
 *  - enum values are written as cast literals (`enumLiteral`), never bound as
 *    parameters, and only after checking them against the enum's own values,
 *    so nothing outside that set can reach the SQL text;
 *  - camelCase identifiers are double-quoted, and `updatedAt` is written
 *    explicitly (Prisma's `@updatedAt` does not run for raw SQL).
 *
 * Rows inserted by raw SQL get a random UUID: Prisma's `cuid()` default is
 * applied by the client, not the database. IDs are opaque strings everywhere.
 */
import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma";

export function utc(value: Date): Prisma.Sql {
  return Prisma.sql`${value.toISOString()}::timestamptz AT TIME ZONE 'UTC'`;
}

/** `utc`, or SQL NULL. */
export function utcOrNull(value: Date | null): Prisma.Sql {
  return value === null ? Prisma.sql`NULL` : utc(value);
}

/**
 * A cast enum literal, e.g. `'TEST'::"public"."ProviderMode"`. `allowed` is the
 * generated Prisma enum object; a value outside it throws before any SQL runs.
 */
export function enumLiteral<T extends string>(
  value: T,
  allowed: Readonly<Record<string, string>>,
  typeName: string,
): Prisma.Sql {
  if (!Object.values(allowed).includes(value)) {
    throw new Error(`enumLiteral: ${JSON.stringify(value)} is not a ${typeName}`);
  }

  return Prisma.raw(`'${value}'::"public"."${typeName}"`);
}

export function newRowId(): string {
  return randomUUID();
}
