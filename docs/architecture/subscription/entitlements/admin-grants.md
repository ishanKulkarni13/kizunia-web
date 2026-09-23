# Admin Grants

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Mechanism behind [`../../../project/feature-specification/subscription/admin-grants.md`](../../../project/feature-specification/subscription/admin-grants.md).

---

## Lifecycle

```text
Admin action: grant(userId, plan, durationOrNull, reason)
  -> refused if userId == acting admin (SB-EA-08)
  -> one transaction:
       EntitlementGrant { userId, plan, source: ADMIN_GRANT, status: ACTIVE,
                          validFrom: now, validUntil: now + duration or null,
                          grantedBy: adminId, reason }
       GrantAuditEntry(action: created, ...)
  -> effective access includes it on the next read

Expiry: validUntil passes
  -> the resolver's filter stops counting it. Nothing is written. "Expired" is a derived,
     displayed property, never a stored status (SB-EA-09)

Extend: a new validUntil
  -> one transaction: update validUntil, GrantAuditEntry(action: extended, from, to, actor, reason)

Revoke:
  -> one transaction: status = REVOKED, GrantAuditEntry(action: revoked, actor, reason)
```

No background job exists for grants. Expiry is a property of the read (`now` within the window), not
an event something has to notice. The earlier design had the resolver opportunistically write
`EXPIRED`; that made authorization checks write to the database on the hottest path and is removed
([SB-EA-09](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-09--grant-expiry-is-derived-when-read-never-written-by-a-read)).

## Concurrency

| Race | Outcome |
| --- | --- |
| Two admins revoke/extend the same grant | Each is a conditional update on the current row plus its own audit entry; the later one wins and both are recorded |
| Revoke while the user is mid-request | The request sees the grant either active or revoked; both were true at some instant |
| Extend an already-expired grant | Allowed; audited as an extension from the old `validUntil` |

## Admin grant does not require Razorpay

Nothing above calls the provider boundary. This is what makes admin grants the mechanism for testing
paid entitlements in every environment — see
[`../cross-cutting/testing-without-razorpay.md`](../cross-cutting/testing-without-razorpay.md). It is
also the correct tool when support wants to give access without payment — never a Dashboard-created
subscription ([SB-WH-06](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-06--events-for-unknown-subscriptions-are-persisted-and-matched-never-dropped)).

## Authorization for granting

Creating, extending or revoking a grant requires a dedicated platform action (e.g.
`MANAGE_ENTITLEMENT_GRANTS`) through `PlatformAuthorizer`, behind the shared admin-route guard the
authorization audit recommends (`kizunia-authorization-compressed-wind.md` §22, P1-2). Self-grants
are refused regardless of role
([SB-EA-08](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-08--administrators-cannot-grant-access-to-themselves)).

## Audit

Every grant/extend/revoke is recorded — see
[`../history-and-audit/admin-grant-audit.md`](../history-and-audit/admin-grant-audit.md).
