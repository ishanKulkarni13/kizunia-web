# Testing

This is the entry point for how testing works in this repository. Read this
first; `database.md` and `conventions.md` go deeper on specific topics.

## Tiers

There are two tiers, distinguished by file suffix only — tests are
co-located next to the source they cover (e.g. `service.ts` next to
`service.test.ts`), not moved into a separate `tests/` directory.

- **Unit** — `*.test.ts`. No database, no network, no real I/O. Fast and
  deterministic. Run with `pnpm test`.
- **Integration** — `*.integration.test.ts`. Allowed to hit a real Postgres
  database (through the app's own `@/lib/prisma` singleton), and to exercise
  multiple layers together. Run with `pnpm test:integration`.

A test that exercises a `route.ts` handler's exported functions directly
in-process (no real HTTP server) — e.g.
`src/app/api/auth/[...all]/route.test.ts` — is not a third tier. It's a
normal `*.test.ts` or `*.integration.test.ts` file, classified the same way
as anything else: does it touch the database or not. Don't build a separate
config or convention just because the thing under test is a route handler.

## Discovery

`vitest.config.mts` (the default, unit config) discovers every `src/**/*.test.ts`
file automatically, excluding `*.integration.test.ts`. You don't need to
register a new test file anywhere — adding one under `src/` with the right
suffix is enough.

`vitest.integration.config.mts` discovers every `src/**/*.integration.test.ts`
file the same way.

## Commands

| Command | Runs | Requires a database? |
|---|---|---|
| `pnpm test` | unit tests | no |
| `pnpm test:integration` | integration tests | yes — `DATABASE_TEST_URL` |
| `pnpm test:all` | both | yes, for the integration half |

## Adding a new test

1. Does it touch the database (directly, or through a service that calls
   Prisma)? If yes, name it `<thing>.integration.test.ts`. If no, name it
   `<thing>.test.ts`.
2. Put it next to the file it's testing.
3. See `conventions.md` for how to handle time and mocking.
4. See `database.md` before writing an integration test — you'll need
   `DATABASE_TEST_URL` set locally.

## What this repository also has, and doesn't replace

`scripts/verify-*.ts` are a separate, existing set of manually-run
regression scripts (`pnpm exec tsx scripts/verify-<name>.ts`). They are not
part of this Vitest setup and aren't being migrated. New coverage for the
kinds of things they check (authorization, visibility, lifecycle invariants)
should prefer the tiers above going forward, but existing verify scripts
stay as they are.

## Deferred

Not part of this foundation, on purpose: Playwright/E2E, React Testing
Library / component tests, coverage tooling, CI, and generic
factory/fixture frameworks. These are real, separable decisions to make
later against an actual need, not now against a hypothetical one.
