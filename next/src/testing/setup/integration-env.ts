/**
 * Loaded via vitest.integration.config.mts's `setupFiles`, before any
 * integration test (or its imports, including `@/lib/prisma`) runs.
 *
 * Integration tests must never run against DATABASE_URL — that's the app's
 * own dev/production connection string. This enforces that
 * DATABASE_TEST_URL is set, is distinct from DATABASE_URL, and looks like a
 * dedicated test database — then makes it the connection Prisma actually
 * uses, since `prisma/schema.prisma` (`env("DATABASE_URL")`) and the shared
 * singleton in `@/lib/prisma` both resolve DATABASE_URL implicitly and have
 * no other way to receive a connection string. See docs/testing/database.md.
 */
import "dotenv/config";

const testUrl = process.env.DATABASE_TEST_URL;

if (!testUrl) {
  throw new Error(
    "DATABASE_TEST_URL is not set. Integration tests require a dedicated " +
      "test database and will not fall back to DATABASE_URL. See " +
      "docs/testing/database.md.",
  );
}

let parsedTestUrl: URL;
try {
  parsedTestUrl = new URL(testUrl);
} catch {
  throw new Error(
    `DATABASE_TEST_URL is not a valid connection string: "${testUrl}". See docs/testing/database.md.`,
  );
}

const testDbName = parsedTestUrl.pathname.replace(/^\//, "");

if (!/test/i.test(testDbName)) {
  throw new Error(
    `DATABASE_TEST_URL's database name ("${testDbName}") does not look like ` +
      'a dedicated test database (expected it to contain "test", e.g. ' +
      '"kizunia_test"). Refusing to run integration tests against it. See ' +
      "docs/testing/database.md.",
  );
}

const appUrl = process.env.DATABASE_URL;

if (appUrl) {
  let parsedAppUrl: URL | null = null;
  try {
    parsedAppUrl = new URL(appUrl);
  } catch {
    parsedAppUrl = null;
  }

  const pointsAtSameDatabase =
    parsedAppUrl !== null &&
    parsedAppUrl.host === parsedTestUrl.host &&
    parsedAppUrl.pathname === parsedTestUrl.pathname;

  if (pointsAtSameDatabase) {
    throw new Error(
      "DATABASE_TEST_URL points at the same host and database as " +
        "DATABASE_URL. Integration tests must use a database distinct " +
        "from the app's own dev/production database. See " +
        "docs/testing/database.md.",
    );
  }
}

// Every check above passed — safe to make this the connection Prisma sees
// for the rest of this test process.
process.env.DATABASE_URL = testUrl;
