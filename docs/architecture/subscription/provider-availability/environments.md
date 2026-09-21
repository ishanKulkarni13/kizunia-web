# Environments

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

---

## Resolution, once, at boot

```text
resolveProviderMode():
  if no RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET configured:
    return "disabled"
  if RAZORPAY_KEY_ID starts with "rzp_test_":
    require the rest of the configuration to also be test-mode-consistent; return "test"
  if RAZORPAY_KEY_ID starts with "rzp_live_":
    require the rest of the configuration to also be live-mode-consistent; return "live"
  otherwise: fail fast at boot — an unrecognized key format is a configuration error, not a mode
```

See [SB-PB-02](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-02--provider-mode-is-resolved-once-at-boot).
**FACT:** test and live keys are non-interchangeable and always prefixed accordingly (see
[`../provider-boundary/razorpay-facts.md`](../provider-boundary/razorpay-facts.md#test-vs-live-mode)).

## Why fail-fast on prefix mismatch, not silent acceptance

A test secret accidentally paired with a live key (or vice versa) is exactly the kind of
misconfiguration that should never reach a running instance quietly — it either fails outright
against Razorpay's API (confusing, hard to diagnose in production) or, worse, could behave in an
unexpected mix of test/live semantics. Validating the pairing at boot turns this into an immediate,
loud startup failure instead of a runtime mystery.

## One seam, not scattered checks

`isBillingProviderEnabled()` (backed by the resolved mode) is the single place code asks "can I do a
real billing operation right now." No feature module reads `process.env.RAZORPAY_...` directly. See
[`../principles.md`](../principles.md).

## Webhook configuration per mode

**FACT:** webhooks are configured independently per mode in the Razorpay Dashboard, each mode having
its own webhook secret (see
[`../provider-boundary/razorpay-facts.md`](../provider-boundary/razorpay-facts.md#test-vs-live-mode)). Kizunia's webhook
signature verification ([`../webhooks/security.md`](../webhooks/security.md)) uses whichever
secret corresponds to the resolved mode — never a single secret assumed to work for both.
