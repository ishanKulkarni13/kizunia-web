# Scope

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

---

## What Phase 0 does

Given a `userId`, the recommendation engine:

1. Loads the user's competition preference profile.
2. Selects candidate competitions (currently open for registration).
3. Evaluates hard constraints, excluding candidates that violate one.
4. Matches remaining candidates against the user's preferences, per
   dimension.
5. Scores each candidate's relevance.
6. Discards candidates below a configured threshold.
7. Ranks the survivors, deterministically.
8. Returns the top N, with an optional debugging/diagnostics view.

That is the whole pipeline. See
[`../../../architecture/recommendation/pipeline.md`](../../../architecture/recommendation/pipeline.md)
for how it is actually built.

## What "done" looks like for Phase 0

- A reusable, tested engine any future consumer (Phase 1 Notifications, a
  future discovery surface, a future mobile client) can call.
- A temporary internal route
  (`/internal/notification/top-competition`) a developer can use to see the
  engine work end to end, for their own account.
- Documentation that matches the implementation exactly.

## Explicitly out of scope

See [`non-goals.md`](non-goals.md).
