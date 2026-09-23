# Security

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

---

## Signature verification is unconditional and first

`X-Razorpay-Signature` (HMAC-SHA256 over the **raw**, unparsed request body, using the webhook
secret configured in the Dashboard — a different secret from the API key pair) is verified before
the body is parsed as JSON, before any database write, and before any business logic runs. See
[SB-WH-01](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-01--signature-is-verified-against-the-raw-body-before-anything-else-happens)
and the underlying [FACT](../provider-boundary/razorpay-facts.md#webhooks).

A failed verification is rejected (400), logged as a security event (see
[`../cross-cutting/observability.md`](../cross-cutting/observability.md)), and never reaches
persistence or processing. A forged payload that is never written anywhere cannot later be picked up
by any process that trusts persisted `BillingEvent` rows.

## Constant-time comparison

The comparison uses the existing constant-time helper (`next/src/lib/security/timing-safe-equal.ts`,
`secretEquals`), not `===`.

## Secret rotation

**FACT.** After the webhook secret is changed, retries of earlier events remain signed with the old
secret ([razorpay-facts](../provider-boundary/razorpay-facts.md#webhooks)). Kizunia therefore accepts
a **previous** secret alongside the current one during a bounded rotation window
([SB-WH-07](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-07--the-previous-webhook-secret-is-accepted-during-a-rotation-window)).
Procedure: [`../cross-cutting/operations-runbook.md`](../cross-cutting/operations-runbook.md#rotating-the-webhook-secret).
Which secret matched is recorded on each `BillingEvent`, so the end of a rotation is observable.

## Forged, replayed and cross-account events

| Threat | Why it fails |
| --- | --- |
| Forged event | No valid signature without the secret |
| Replay of a captured genuine event | Same `dedupeKey` → no-op. Even a replay that bypassed dedupe only triggers a *fetch* of current state — the payload is never applied, so a replay cannot move a subscription backwards |
| Event from another Razorpay account or the other mode | Different webhook secret per account and per mode; additionally the payload's `account_id` must equal the configured merchant account ID, else the event is rejected and logged |
| Genuine event naming someone else's subscription | Only matters through a fetch of that subscription; access changes only for the Subscription the provider ID is bound to |

## The payload is never trusted as the sole source of truth

Signature verification proves the payload came from Razorpay. It does not prove the payload
represents the *current* state — see [`ordering-and-staleness.md`](ordering-and-staleness.md).

## The endpoint is public, but not undefended

The route accepts unauthenticated POSTs by necessity. It is rate-limited at the IP level with the
existing rate-limit infrastructure, generously (bursts after an outage or a Dashboard bulk action are
legitimate), to bound the cost of garbage traffic before signature verification rejects it.
**FACT.** Razorpay publishes its webhook source IPs
([razorpay-facts](../provider-boundary/razorpay-facts.md#webhooks)); an IP allowlist at the edge is
optional defense-in-depth, never a substitute for signature verification, and must be updated if
Razorpay changes its list.

## Never trust client-supplied subscription/plan data

No subscription or plan mutation is accepted from a request body's `plan`, `subscriptionId` or
similar field, on this route or any user-facing API. State changes originate only from an
authoritative Razorpay read, a verified command response, or an authorized admin action. Checkout
confirmation verifies the signature against the **server-held** subscription ID and then only
triggers a fetch ([SB-CM-06](../../../project/feature-specification/subscription/decisions/commands-and-idempotency.md#sb-cm-06--checkout-confirmation-syncs-only-the-callers-own-subscription)).

## What must never be logged

Full payloads may include the customer's contact details. Logs record identifiers (event id, Kizunia
subscription id, user id) and transitions, never raw payment-instrument data or unnecessary PII.
Raw payloads live only in `BillingEvent`, behind billing-admin access, for a bounded retention period
([SB-DP-04](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)).
