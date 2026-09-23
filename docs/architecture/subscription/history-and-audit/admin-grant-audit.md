# Admin Grant Audit

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

---

## What is recorded

Every `EntitlementGrant` creation, extension, and revocation, attributed to an actor:
`{ grantId, action: created | extended | revoked, performedBy, targetUser, plan, duration/validUntil,
reason, timestamp }`. Written in the same transaction as the grant change. `performedBy` is an admin
for `ADMIN_GRANT` and the redeeming user (with the promotion code) for `PROMOTION`. Expiry is not an
audited action — it is derived from `validUntil` and never written
([SB-EA-09](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-09--grant-expiry-is-derived-when-read-never-written-by-a-read)).
A self-grant is refused before anything is written
([SB-EA-08](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-08--administrators-cannot-grant-access-to-themselves)).

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
own inputs, an investigator can answer, for any point in time: what each of the user's Subscriptions'
phases was, what grants were active, who granted them and why, and what the resulting effective
access was — without needing anything beyond these two tables plus the `EntitlementGrant` rows
themselves.
