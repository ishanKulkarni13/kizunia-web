# Testing Strategy

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Notifications uses the repository's existing testing setup. Nothing here introduces a parallel
system.

The authoritative documents are [`next/docs/testing/README.md`](../../../../next/docs/testing/README.md),
[`conventions.md`](../../../../next/docs/testing/conventions.md) and
[`database.md`](../../../../next/docs/testing/database.md). This page records how notification
work maps onto them.

---

## The two tiers

Distinguished by file suffix only; tests are co-located next to the source they cover.

| Tier | Suffix | Database | Command |
| --- | --- | --- | --- |
| **Unit** | `*.test.ts` | No database, no network, no real I/O | `pnpm test` |
| **Integration** | `*.integration.test.ts` | Real Postgres via the app's own Prisma singleton | `pnpm test:integration` |

Discovery is automatic — a file with the right suffix under `src/` needs no registration.

---

## Where notification tests land

| Subject | Tier | Why |
| --- | --- | --- |
| A filter's accept/reject decision | Unit | Pure logic over a context |
| Relevance scoring | Unit | Pure logic over a profile and a candidate |
| Ranking and selection policies | Unit | Pure logic over a scored set |
| Aggregation policy | Unit | Pure logic over a selection |
| Preference semantics — weight 0, hard-constraint dominance, empty profile | Unit | Pure rules |
| Missing-data matrix | Unit | Pure rules |
| Deduplication **rules** | Unit | The decision, given known history |
| Deduplication **against stored history** | Integration | Requires real rows |
| Candidate selection queries | Integration | Requires real data and real indexes |
| Generation and persistence | Integration | Writes records |
| Intent isolation — one intent not suppressing another | Integration | Spans stored history |
| A full evaluation for one user | Integration | End-to-end, deliberately few |

The shape that falls out: **most notification rules are unit-testable**, because the pipeline's
stages operate on a context rather than on a database. That is the design working as intended.

---

## The rule that decides the tier

> Does it touch the database, directly or through a service that calls Prisma?

If yes, it is `*.integration.test.ts`. If no, it is `*.test.ts`.

**Do not mock Prisma** — not in either tier. Logic that needs Prisma belongs in the integration
tier, not in a unit test with a mocked client. This is an existing repository decision and it
avoids maintaining a Prisma mock library at all.

The practical consequence for this subsystem: keep rules separable from data access, so the rule is
unit-testable and only the query is integration-tested.

---

## Time

Notification logic is unusually time-dependent — a daily sweep, a T-24h deadline window, deadline
timestamps, `registrationStartDate` boundaries.

The repository's convention has a clear preference order:

1. **If the function already takes a timestamp, pass one.** Much of the codebase does this.
2. If it genuinely reads the clock internally, use Vitest's `vi.useFakeTimers()` /
   `vi.setSystemTime()`.
3. For integration tests comparing against the database's own `NOW()`, assert relative to a
   `new Date()` captured at the start of the test — fake timers do not affect Postgres.

**Notifications should live squarely in option 1.** The evaluation timestamp is established once,
in the processing context, rather than read ambiently at each stage
([`../pipeline/processing-context.md`](../pipeline/processing-context.md)).

That is a design decision made partly *for* testability: a test can evaluate "as of" any moment by
passing it, with no fake timers and no system-time manipulation. Given how much of this subsystem's
behavior is a function of time, that is worth the small discipline it costs.

---

## Mocking

Follow the existing conventions. Of the documented seams, the one notification work will need is
**session/auth** — stub `SessionService.getActor` / `getOptionalActor` / `getStrictActor`, the
single chokepoint every controller calls, rather than faking a session cookie.

Scheduled-job endpoints need no session mocking at all: they authenticate with a shared secret and
have no actor
([`../triggers/scheduled-evaluation.md`](../triggers/scheduled-evaluation.md)).

Testing a route handler's exported functions in-process is **not** a third tier — it is classified
like anything else, by whether it touches the database.

---

## The pyramid, and what it means here

```text
focused unit tests -> module/integration tests -> carefully selected end-to-end behavior
```

> The system should not require massive integration tests for every small business rule.

"Carefully selected" is the operative phrase for the top tier. A full evaluation test is slow, and
one of them proves the wiring; twenty of them prove the wiring twenty times while making every rule
change expensive.

Rules belong at the bottom of the pyramid. If a rule can only be demonstrated at the top, that is a
finding about the architecture, not about the test
([test-surface.md](test-surface.md)).
