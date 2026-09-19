# Conventions

## Time

No production code needs to change for this. Prefer, in order:

1. If the function under test already takes a timestamp/`Date` as a
   parameter (much of the codebase already does this — e.g.
   `PostgresRateLimitStore.increment(key, expiresAt)`), just pass the value
   the test wants. No mocking needed.
2. If it genuinely reads `Date.now()`/`new Date()` internally and the test
   needs to control that, use Vitest's built-in `vi.useFakeTimers()` /
   `vi.setSystemTime()`. This ships with Vitest already — no new dependency,
   and no `Clock`/time-provider abstraction needs to be added to production
   code for it to work.
3. For integration tests involving expiry against real Postgres (e.g. rows
   with an `expiresAt` compared against the database's own `NOW()`), prefer
   asserting relative to a `new Date()` captured at the start of the test
   rather than fake timers — fake timers only affect the Node process, not
   the database.

## Mocking

**Mock these:**

- **Cloudinary** — the SDK is imported in exactly one file,
  `src/modules/assets/backend/storage/cloudinary.provider.ts` (documented as
  the only place allowed to import it). Mock that module; don't reach for
  the `cloudinary` SDK directly anywhere else.
- **Google Places** — already has a designed seam,
  `GOOGLE_PLACES_BASE_URL`, documented in `.env.example` as overridable "to
  point at a stub or proxy during testing." Use that rather than a second
  mocking mechanism.
- **Session/auth** — for a test that needs a fake authenticated actor, stub
  `SessionService.getActor` / `getOptionalActor` / `getStrictActor`
  (`src/lib/auth/session.ts`), which is the single chokepoint every
  controller already calls. Don't try to fake a Better Auth cookie/session
  directly.
- **Randomness**, where a test needs determinism over `Math.random()`-based
  logic — use `vi.spyOn(Math, "random")` locally within that test, restored
  afterward.

**Don't mock these:**

- **Prisma / the database, in integration tests.** The point of that tier
  is real Postgres behavior — e.g. proving an atomic upsert has no lost
  updates under concurrency, which a mock can't demonstrate.
- **Prisma in unit tests** — don't mock it either; if a piece of logic needs
  Prisma, it belongs in the integration tier, not a unit test with a mocked
  Prisma client. This avoids maintaining a Prisma mock library at all.
- **`Route.execute` / `ApiResponse` / `ErrorHandler`** — cheap and
  deterministic already; exercise them directly and in-process the way
  `http-contract.test.ts` does.

## Naming

- Unit: `<thing>.test.ts`, next to the file it tests.
- Integration: `<thing>.integration.test.ts`, next to the file it tests.
- No separate `tests/`/`__tests__` directory — this repo co-locates.
