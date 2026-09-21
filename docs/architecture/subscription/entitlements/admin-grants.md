# Admin Grants

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Mechanism behind [`../../../project/feature-specification/subscription/admin-grants.md`](../../../project/feature-specification/subscription/admin-grants.md).

---

## Lifecycle

```text
Admin action: grant(userId, plan, durationOrNull, reason)
  -> EntitlementGrant created: { userId, plan, source: ADMIN_GRANT, status: ACTIVE,
                                  validFrom: now, validUntil: now + duration or null,
                                  grantedBy: adminId, reason }
  -> effective access recalculates on next read; no immediate push to the user is required —
     the change is visible the next time anything checks the user's access

Expiry (no explicit revoke): validUntil passes
  -> effective-access resolution's own filter (`now within [validFrom, validUntil)`) simply stops
     counting it — no separate expiry job needs to run to "notice" this

Explicit revoke:
  -> EntitlementGrant.status set to REVOKED, with a revocation reason and actor recorded
  -> effective access recalculates on next read
```

No background job is required to expire a grant. This is deliberate: expiry is a property of the
*read* (is `now` within the validity window), not an event that has to be observed and acted on by a
scheduled task. The alternative — a job that flips `status` to `EXPIRED` when the window passes —
adds a moving part with no behavioral benefit and a real risk (the job not running for a period
leaves a stale `ACTIVE` status that reads correctly today but would mislead a future direct table
inspection). `EXPIRED` as a status value is reserved for exactly that direct-inspection clarity, set
opportunistically by whatever process next resolves that user's access, not by a scheduled sweep.

## Admin grant does not require Razorpay

Nothing above calls the provider boundary. This is what makes admin grants the mechanism for testing
paid entitlements in every environment — see
[`../cross-cutting/testing-without-razorpay.md`](../cross-cutting/testing-without-razorpay.md).

## Authorization for granting

Creating, extending, or revoking a grant requires the same platform-action-gated authorization any
other administrative operation uses (`PlatformAuthorizer.can(..., MANAGE_...)`), following the
existing admin-route-guard recommendation from the authorization audit
(`kizunia-authorization-compressed-wind.md` §22, P1-2) — admin-grant UI is exactly the kind of new
admin surface that audit flagged as needing a structural guard rather than per-page discipline.

## Audit

Every grant/extend/revoke is recorded — see
[`../history-and-audit/admin-grant-audit.md`](../history-and-audit/admin-grant-audit.md).
