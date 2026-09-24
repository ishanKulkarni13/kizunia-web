# Portfolio and Entitlements

> **Status:** Stable
>
> **Last Updated:** 2026-09-21

Portfolio is the one module where the pre-existing authorization audit found a genuine, undecided
data-model gap ([`kizunia-authorization-compressed-wind.md`](../../../temp/kizunia-authorization-compressed-wind.md), §7,
§17). This document resolves it.

---

## Three distinct questions, not one

| Question | Answer depends on |
| --- | --- |
| Does the portfolio **exist**? | Whether a `Portfolio` row exists for the user |
| Is it **editable**? | Ownership only — the owner can always edit their own portfolio |
| Is it **publicly displayable**? | Entitlement — requires Pro or Pro+ |
| Is it **actually public right now**? | Publicly displayable **and** the owner's own `visibility` preference is `PUBLIC` |

A Free user cannot create a portfolio at all. A Pro/Pro+ user who downgrades to Free keeps their
portfolio, can keep editing it, but it can no longer be shown at its public URL — regardless of
their own `visibility` setting.

```text
Pro user: portfolio exists, editable, visibility = PUBLIC, entitled -> publicly visible
  downgrades to Free
Free user: portfolio still exists, still editable, visibility = PUBLIC (unchanged), not entitled
  -> not publicly visible
  upgrades back to Pro
Pro user: portfolio still exists, still editable, visibility = PUBLIC (was never touched), entitled
  -> publicly visible again, with no re-configuration needed
```

## Why entitlement never touches `visibility`

The owner's own visibility preference is theirs to control and must never be silently changed by an
entitlement loss — forcing `visibility` to `PRIVATE` on downgrade would be indistinguishable from
Kizunia overriding the user's own choice, and would require restoring it correctly later (a second,
easy-to-get-wrong invariant). Instead, "publicly displayable" is evaluated as an **independent,
additional** gate alongside `visibility`, and both must hold. This directly resolves the
authorization audit's flagged gap using a seam that already exists in the codebase — see
[`../../../architecture/subscription/entitlements/authorization-integration.md`](../../../architecture/subscription/entitlements/authorization-integration.md#portfolio-public-eligibility).

## Related rulings

[`decisions/data-preservation.md`](decisions/data-preservation.md#sb-dp-02--portfolio-visibility-is-never-overridden-by-entitlement-loss).
