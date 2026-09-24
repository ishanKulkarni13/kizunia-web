# Environments

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-13)

---

## Resolution, once, at boot

```text
resolveProviderMode():
  if no RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET configured:
    return "disabled"
  if RAZORPAY_KEY_ID starts with "rzp_test_":
    require the rest of the configuration to be test-mode-consistent; return "test"
  if RAZORPAY_KEY_ID starts with "rzp_live_":
    require the rest of the configuration to be live-mode-consistent; return "live"
  otherwise: fail fast at boot — an unrecognized key format is a configuration error, not a mode

expectedBillingMode():            -- configured, independent of credentials (SB-EA-07)
  BILLING_EXPECTED_MODE if set ("test" | "live")
  else VERCEL_ENV == "production" -> "live"; every other deployment -> "test"
  resolved mode must equal it, or be "disabled"; anything else fails fast at boot
```

**Where it runs (decided 2026-09-24,
[IB-13](../implementation/open-decisions.md#ib-13--boot-time-mode-validation-and-expected-mode)).**
The repository has no env-validation module and no instrumentation hook. Billing configuration is
therefore validated in `src/instrumentation.ts` `register()` at server start, the Next.js boot hook,
which the billing phase adds. The expected mode now has an explicit source: an optional
`BILLING_EXPECTED_MODE`, falling back to Vercel's `VERCEL_ENV` (which the application does not read
anywhere yet). `.env.example` documents every billing variable. Missing credentials are not an error:
they resolve to `disabled`, a supported production state
([SB-PB-03](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-03--disabled-is-a-fully-supported-production-state)).

See [SB-PB-02](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-02--provider-mode-is-resolved-once-at-boot).
The `rzp_test_`/`rzp_live_` prefixes are an established Razorpay convention relied on here; the
fetched documentation states only that test and live keys are separate and non-interchangeable
([razorpay-facts](../provider-boundary/razorpay-facts.md#test-vs-live-mode)). A key that matches
neither prefix therefore fails fast rather than being guessed.

## Why two modes: resolved and expected

The *resolved* mode says what Kizunia can do now (it may be `disabled` because credentials are
missing). The *expected billing mode* says which subscriptions are real for this deployment. Keeping
them separate is what lets a production deployment without credentials keep honoring its `live`
subscriptions, while guaranteeing a `test` subscription never grants access in production
([SB-EA-07](../../../project/feature-specification/subscription/decisions/effective-access-and-grants.md#sb-ea-07--a-subscription-contributes-only-in-the-provider-mode-it-was-created-in)).

## Mode stamping

Every Subscription, `BillingOperation` and `BillingEvent` records the provider mode it belongs to
(for an event, the mode of the webhook secret that verified it). Consequences:

- Synchronization runs only for Subscriptions whose mode equals the resolved mode.
- A mismatch found anywhere (a row of the other mode synchronized, a `notes.kz_env` that disagrees)
  raises `PROVIDER_MODE_MISMATCH` and is never applied.
- A database copied between environments cannot make test payments grant production access.

## Why fail-fast on mismatch, not silent acceptance

A test secret paired with a live key, or a production deployment configured with test keys, is
exactly the kind of misconfiguration that should never reach a running instance quietly. Validating
at boot turns it into an immediate startup failure instead of a runtime mystery.

## One seam, not scattered checks

`isBillingProviderEnabled()` (backed by the resolved mode) is the single place code asks "can I do a
real billing operation right now". No feature module reads `process.env.RAZORPAY_...` directly. See
[`../principles.md`](../principles.md).

## Webhook configuration per mode

**FACT.** Webhooks are configured separately per mode, each with its own URL and secret, and the
payload carries no mode flag ([razorpay-facts](../provider-boundary/razorpay-facts.md#webhooks)).
Kizunia verifies with the secret(s) of the resolved mode only — including the previous secret during
a rotation window ([SB-WH-07](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-07--the-previous-webhook-secret-is-accepted-during-a-rotation-window)) —
and additionally checks the payload's `account_id` against the configured merchant account.

## Plan catalog per mode

Test and live Razorpay plans (and Offers) are different objects. The plan catalog and the
marketing-code → Offer map are configured per mode
([SB-PB-05](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-05--provider-plan-ids-map-to-kizunia-plans-through-a-per-mode-catalog-many-to-one)).
