# Integration test database

Integration tests (`*.integration.test.ts`) run against a real Postgres
database, through the app's own `@/lib/prisma` singleton. They must never
run against `DATABASE_URL` — that's the app's dev/production database.

## One-time setup

1. Create a database of its own on the same (or any reachable) Postgres
   server, with a name that contains `test`, e.g. `kizunia_test`:

   ```
   createdb kizunia_test
   ```

2. Apply the schema to it:

   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5433/kizunia_test" pnpm exec prisma migrate deploy
   ```

   Re-run this whenever a new migration is added to `prisma/migrations/`.

3. Set `DATABASE_TEST_URL` in your `.env` (see `.env.example`) to that same
   connection string:

   ```
   DATABASE_TEST_URL="postgresql://postgres:postgres@localhost:5433/kizunia_test"
   ```

## Running

```
pnpm test:integration
```

## Safety rules

`src/testing/setup/integration-env.ts` runs before every integration test
file (and before any of its imports, including `@/lib/prisma`) and refuses
to proceed unless all of the following hold:

- `DATABASE_TEST_URL` is set at all.
- It's a parseable connection string.
- Its database name contains `test` (case-insensitive) — e.g. `kizunia_test`,
  not `kizunia`.
- It is not the same host + database as `DATABASE_URL` (when `DATABASE_URL`
  is also set) — a test database can live on a different server than dev,
  including a remote one, but it can never *be* the same database dev uses.

If any check fails, the setup throws before any test body runs — tests fail
loudly, they never silently skip or silently fall back to `DATABASE_URL`.

Once the checks pass, the setup file sets `process.env.DATABASE_URL =
process.env.DATABASE_TEST_URL` for the rest of that test process. This is
the only way integration tests can reuse the existing `@/lib/prisma`
singleton and `prisma/schema.prisma` (both resolve `DATABASE_URL`
implicitly, with no other way to receive a connection string) without a
second, parallel Prisma client just for tests.

## Cleanup / isolation

There's no generic truncate-all-tables or transactional-rollback framework
here, and none is planned — at current test volume it isn't needed. The
existing convention (see `postgres.store.integration.test.ts`) is:

- Give test rows a distinctive, unique key/name (e.g. a fixed prefix plus
  `Date.now()`/`Math.random()`).
- Delete exactly those rows in `afterAll` (or `afterEach` if a test needs
  isolation from other tests in the same file), then call
  `prisma.$disconnect()`.

Follow this same pattern for new integration tests rather than introducing
a new cleanup mechanism.

## Parallel execution

Vitest's default per-file parallelism is fine as long as test data uses
unique keys, as above. Revisit this only if integration test volume grows
enough that cross-test collisions actually start happening.
