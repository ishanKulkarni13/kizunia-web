# Admin Grant Audit

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

---

## What is recorded

Every `EntitlementGrant` creation, extension, and revocation, attributed to an actor:
`{ grantId, action: created | extended | revoked, performedBy, targetUser, plan, duration/validUntil,
reason, timestamp }`.

## Following the notification subsystem's precedent

The notification subsystem never overwrites a delivered record — a later event produces a new
record, not a mutation of the old one (`ND-H-02`, "history is retained and never overwritten"). Grant
audit follows the same philosophy: an extension or revocation is a new audit entry referencing the
original grant, not an edit that erases what the grant originally said. This is deliberately
consistent with an existing, working convention rather than inventing a different audit philosophy
for this one subsystem.

## Why this is new scaffolding, not a reuse

The codebase has no generic `AuditLog` table today (`VIEW_AUDIT_LOGS` is a reserved, unimplemented
permission — `kizunia-authorization-compressed-wind.md` §14 area). Building one generic system to
serve a single current consumer would be speculative; this design adds a purpose-built table for
exactly what admin grants need, following the same shape a future generic audit system would likely
also use, without waiting for one to exist.

## Answering "why does this user have this access"

Combined with [`subscription-history.md`](subscription-history.md) and effective-access resolution's
own inputs, an investigator can answer, for any point in time: what the user's paid Subscription
phase was, what grants were active, who granted them and why, and what the resulting effective
access was — without needing anything beyond these two tables plus the `EntitlementGrant` rows
themselves.
