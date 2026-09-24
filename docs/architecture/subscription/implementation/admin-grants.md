# Admin Grants

> **Status:** Implementation plan — not implemented
>
> **Last Updated:** 2026-09-24
>
> **Blueprint section:** §14 (see the [section map](README.md#blueprint-section-map))

Admin grants designed independently of Razorpay: creation, expiry, revocation, audit and history, authorization, effect on effective access, interaction with paid subscriptions, and the difference between admin users and admin-granted customer access.

**Open decisions referenced here:** [IB-15](open-decisions.md#ib-15--billing-admin-roles). Text that follows a recommended resolution is provisional until that item is ruled; see [open decisions](open-decisions.md).

---

| Aspect | Design |
| --- | --- |
| Authorization | `PlatformAuthorizer.can({actor}, MANAGE_ENTITLEMENT_GRANTS)` in `GrantService` (roles IB-15). No `platformOverride` for this action. Admin pages sit behind the existing `admin/layout.tsx` `ACCESS_ADMIN_DASHBOARD` guard, and every API route re-authorizes |
| Create | Refuse `recipient == actor` (SB-EA-08; also DB CHECK). One tx: `EntitlementGrant{ADMIN_GRANT, ACTIVE, validFrom=now, validUntil=now+duration?, grantedBy, reason}` + `GrantAuditEntry(CREATED)` |
| Expiry | Derived at read time; nothing written; no job |
| Extend | Conditional `updateMany where {id, status: ACTIVE}` + `GrantAuditEntry(EXTENDED, previous→new)`; allowed on expired grants |
| Revoke | Conditional update to `REVOKED` + audit; both concurrent admin actions are recorded |
| Effective access | Just another `max` input; exceeds or falls back to paid access without touching the Subscription (SB-EA-02/03) |
| Paid interaction | Independent. The Subscription keeps billing. The UI shows both sources. The explain view says which one is winning |
| Admin users vs admin-granted access | Admin role = operational bypass on interactive chains. Admin *grant* = customer access. An admin who needs customer access (for example notifications) gets a grant from **another** admin |
| API | `GET/POST /api/v1/admin/billing/grants`, `POST …/grants/{id}/extend`, `POST …/grants/{id}/revoke`, `GET /api/v1/admin/billing/users/{id}/access` (explain) |
| Razorpay | Never called; works in disabled mode; the test tool for every paid feature |

---

## Related documents

**In this directory**

- [Effective Access](effective-access.md)
- [Entitlements and Quotas](entitlements-and-quotas.md)
- [Database Design](database-design.md)
- [Open decisions](open-decisions.md) · [Settled decisions](settled-decisions.md) · [Index](README.md)

**Design and specification**

- [Admin grants (design)](../entitlements/admin-grants.md)
- [Admin grant audit](../history-and-audit/admin-grant-audit.md)
- [Product — admin grants](../../../project/feature-specification/subscription/admin-grants.md)
- [Testing without Razorpay](../cross-cutting/testing-without-razorpay.md)
