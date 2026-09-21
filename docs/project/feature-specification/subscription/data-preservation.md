# Data Preservation

> **Status:** Stable
>
> **Last Updated:** 2026-09-21

> **Subscription changes should change access. They should never destroy user data.**

This is a non-negotiable invariant, not a default that can be quietly reconsidered during
implementation. Losing paid access — through downgrade, cancellation, or expiration — changes what
a user can newly access or create. It never deletes what they already have.

---

## Projects

A downgrade that puts a user over their new plan's owned-project quota does not delete, archive, or
lock any existing project. The user keeps full normal access to every project they already own or
are a member of. Only **creating a new owned project** is blocked while the user remains over quota.

```text
Pro+ user owns 18 projects
  -> downgrades to Pro (quota: 10)
  -> all 18 projects remain, fully accessible
  -> creating project #19 is blocked until owned count is back at or under 10
```

## Portfolio

A portfolio is never deleted because paid access ended. The user can still view and edit it. What
changes is whether it can be shown at its public URL — see
[`portfolio-and-entitlements.md`](portfolio-and-entitlements.md) for the exact distinction.

## Notification preferences

Notification preferences and the competition preference profile are never reset or cleared by a
plan change, in either direction. A user who upgrades, downgrades, and upgrades again finds every
preference exactly as they left it — see
[`entitlements-and-effective-access.md`](entitlements-and-effective-access.md#preferences-always-survive).

## MCP configuration

Any MCP-related configuration a user has set up is preserved across plan changes for the same
reason: losing MCP access means MCP requests can no longer be authorized, not that the
configuration behind it is erased.

---

## Why this matters more than it looks

Getting this wrong is a trust failure, not a cosmetic one. A user who discovers that a lapsed
payment deleted their work will not come back, regardless of whether the plan is later restored. It
also simplifies re-upgrade: because nothing was destroyed, restoring access is purely a matter of
effective access recomputing — there is no data to "restore" alongside it.

## Related rulings

[`decisions/data-preservation.md`](decisions/data-preservation.md).
