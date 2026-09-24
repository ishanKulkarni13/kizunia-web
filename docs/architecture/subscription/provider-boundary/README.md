# Provider Boundary

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Everything Razorpay-specific lives here, and nowhere else in the codebase.

| Document | Contents |
| --- | --- |
| [`razorpay-facts.md`](razorpay-facts.md) | Every verified Razorpay behavior this design depends on, cited to official documentation |
| [`interface-and-abstraction.md`](interface-and-abstraction.md) | The narrow `BillingProvider`-shaped interface and its classified outcomes |
| [`identifiers.md`](identifiers.md) | Why Razorpay IDs never leak past this boundary |

## How to read `razorpay-facts.md`

Every row is tagged:

| Tag | Means |
| --- | --- |
| **FACT** | Explicitly documented by Razorpay, with a source URL |
| **INTERPRETATION** | Kizunia's engineering conclusion, built from one or more facts |
| **OPEN** | Could not be conclusively established from current documentation — see [`../../../project/feature-specification/subscription/open-decisions.md`](../../../project/feature-specification/subscription/open-decisions.md) |

Facts were verified against current official Razorpay documentation on 2026-09-21 and re-verified on
2026-09-24. Razorpay's own
documentation can change; if behavior described here stops matching what Razorpay's dashboard or API
actually does, this file — not the assumption baked into a ruling — is what's wrong, and both should
be corrected together.
