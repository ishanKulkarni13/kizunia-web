# Security

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

---

## Signature verification is unconditional and first

`X-Razorpay-Signature` (HMAC-SHA256 over the **raw**, unparsed request body, using the webhook
secret configured in the Dashboard — a different secret from the API key pair) is verified before
the body is parsed as JSON, before any database write, and before any business logic runs. See
[SB-WH-01](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-01--signature-is-verified-against-the-raw-body-before-anything-else-happens)
and the underlying [FACT](../provider-boundary/razorpay-facts.md#webhooks).

A failed verification is rejected (4xx), logged as a security event (see
[`../cross-cutting/observability.md`](../cross-cutting/observability.md)), and never reaches
persistence or processing. This is deliberate: a forged payload that never gets written anywhere
cannot later be picked up by reconciliation or any other process that trusts persisted
`BillingEvent` rows.

## Constant-time comparison

The signature comparison uses a constant-time equality check, consistent with the existing
`secretEquals`-style helper already used for the `CRON_SECRET`-gated internal routes — not a plain
`!==`/`===`, which the authorization audit already flagged as a timing-side-channel risk elsewhere
in the codebase (`kizunia-authorization-compressed-wind.md` §18). The webhook secret is exactly the
kind of credential that check exists to protect.

## The payload is never trusted as the sole source of truth

Signature verification proves the payload came from Razorpay. It does not prove the payload
represents the *current* state — see [`ordering-and-staleness.md`](ordering-and-staleness.md) for why
state-changing events still trigger an authoritative refetch even after successful verification.

## The endpoint is public, but not undefended

The webhook route accepts unauthenticated POST requests by necessity — Razorpay is not a session-
bearing actor. It is still rate-limited defensively at the IP/subject level using the existing
rate-limit infrastructure, fail-closed with a generous limit calibrated to Razorpay's actually
low, predictable traffic volume — not to authenticate Razorpay, but to bound the cost of an
attacker probing the endpoint with garbage payloads before signature verification rejects them.

## Never trust client-supplied subscription/plan data

No subscription or plan mutation is ever accepted from a request body's `plan`, `subscriptionId`, or
similar field, whether on the webhook route or any user-facing API. All subscription state changes
originate from: a verified webhook, an authoritative Razorpay fetch, or an authorized admin action —
never from a value a client sent.

## What must never be logged

Full webhook payloads may include the customer's contact details and Razorpay's own transaction
metadata. Logs record identifiers (event id, subscription id, user id) and phase transitions, never
raw payment instrument data or unnecessary customer PII — see
[`../cross-cutting/observability.md`](../cross-cutting/observability.md).
