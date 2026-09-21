# History and Audit

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

Billing is financially sensitive; every access-affecting change must be reconstructable after the
fact — "why does this user currently have this access?"

| Document | Contents |
| --- | --- |
| [`subscription-history.md`](subscription-history.md) | The append-only `SubscriptionHistoryEntry` trail |
| [`admin-grant-audit.md`](admin-grant-audit.md) | Grant/revoke/extend audit trail |

No generic `AuditLog` table exists in the codebase today — `VIEW_AUDIT_LOGS` is a reserved,
unimplemented platform permission. Both documents here describe new, purpose-built scaffolding, not
a reuse of something generic that doesn't yet exist.
