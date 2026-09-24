# Razorpay Feasibility & Integration Research Audit — Kizunia Subscription & Membership

**Type:** Research/feasibility deliverable. No code, schema, or implementation plan.
**Inputs:** `docs/temp/suscriptions.md` (product decisions, treated as source of truth, not reinterpreted) + `docs/temp/kizunia-authorization-compressed-wind.md` (existing authorization audit, reused rather than repeated) + official Razorpay documentation (cited inline).
**Purpose:** Determine what Razorpay can/cannot support, what should be Razorpay-owned vs Kizunia-owned vs hybrid, what can be built before Razorpay exists, and what product assumptions may need to change — before any architecture or implementation work starts.
**Non-goals:** No API implementation, no Prisma models, no webhook handler code, no coding tickets. Open product decisions in the source document remain open here.

---

## 1. Source Document: Fixed Decisions, Open Decisions, Future Scope

Recap only — not reinterpreted. Section numbers refer to `suscriptions.md`.

### Fixed for initial scope (§61, §88)
- Plans: Free, Pro, Pro+. Billing: Monthly, Yearly.
- Project ownership caps: Free=5, Pro=10, Pro+=20 (ownership only, not membership).
- Portfolio: Free=no, Pro/Pro+=yes. Deadline notifications: Free=no, Pro/Pro+=yes. Recommendations: Pro+=only. MCP: Pro+=only.
- Admin: full access, no subscription required, must work even with Razorpay unconfigured (§17, §57).
- Downgrade: non-destructive to data; only blocks *new* creation above the new limit (§10‑§12, §66).
- Provider independence: no domain code may branch on `razorpayPlanId`/`razorpaySubscriptionId`/`razorpayPaymentId` (§15, §39, §82).
- 7-day *configurable* grace period on failed recurring payment (§23), exact entitlements during grace period explicitly **not** decided (§24).
- Entitlement sources must be pluggable: `DEFAULT_FREE | PAID_SUBSCRIPTION | FREE_TRIAL | ADMIN_GRANT | COUPON | PROMOTION | ONE_TIME_PURCHASE` (§37).
- Preferences (notification/competition) survive plan changes in both directions (§27‑§29, §79).

### Explicitly open (§84 — must not be silently decided by this report)
Exact subscription state model; upgrade/downgrade timing; cancellation timing (immediate vs end-of-period); exact grace-period entitlements; trial eligibility/duration/conversion/payment-method requirement/multiplicity; coupon eligibility/stacking; admin grant duration/precedence/revocation; MCP access-level model; portfolio public-visibility data model; one-time-purchase/refund/theme-ownership model.

### Future scope, must not be structurally foreclosed (§62)
Free trials, coupon codes (percentage/flat/free-period/free-plan), admin gifting, promotional grants, one-time purchases, paid portfolio themes, fine-grained MCP levels, more plans, unlimited-style quotas.

### Architectural constraints (§39, §77, §82‑§83, §89)
Razorpay is a billing integration behind a translation boundary; project/portfolio/notification/MCP systems must never need to understand Razorpay; plan ≠ entitlement; feature flags ≠ entitlements; reliability (idempotency, dedup, reconciliation, safe partial failure) is a hard requirement, not a nice-to-have.

---

## 2. Codebase Integration Points (narrow scan — full authorization audit already exists)

The full authorization/readiness audit in `docs/temp/kizunia-authorization-compressed-wind.md` already covers identity, authorization, project ownership, portfolio, notifications, MCP, rate limiting, admin, and background jobs in depth — not repeated here. Only the billing-specific seams and the gaps that audit didn't cover are added below.

| Concern | Current state | Relevance to Razorpay integration |
|---|---|---|
| Identity boundary | `SessionService.{getActor,getStrictActor,getOptionalActor}` re-reads `{id, role, banned}` from Postgres every call; MCP re-resolves via the same `PlatformContextResolver` | This is the natural point to hang `resolveEntitlements(actor)` off of — already the single choke point for "who is this" |
| Entitlement seam | `lib/entitlements/index.ts::resolveEntitlements()` stubbed to `{tier:"default"}`; `lib/rate-limit/resolver.ts::resolvePolicy(policyId, subject, entitlements)` already threads (but ignores) entitlements | Razorpay-derived state should flow into this single resolver, not into 14 separate call sites |
| Project ownership counting | `ProjectMember.role = OWNER` row, distinct from membership; no existing "count owned projects" repository method | Clean seam for a quota check; independent of billing entirely |
| Portfolio | `visibility` (PUBLIC/PRIVATE) is the *only* axis — no separate "publicly displayable" concept independent of the user's own preference | A real pre-existing gap (not Razorpay's fault) that downgrade behavior (§12 of the product doc) depends on |
| Notifications / MCP / recommendations | Zero entitlement checks anywhere today; preference vs. delivery-eligibility already cleanly separated | Insertion point is the scheduler query + ID-scoped re-checks, not the authorization layer (background jobs don't run through it by design) |
| Admin | `PlatformRole` (ADMIN/SUPER_ADMIN) is already fully orthogonal to any plan concept; no `Plan` model exists yet to conflate it with | Clean; but no centralized admin-route guard exists yet — relevant before shipping an "Admin Grant Plan" page |
| Background jobs / queue | Hand-rolled Postgres work queue (`notifications/jobs/postgres-work-queue.ts`), `JobRunner` with backoff, `occurrenceKey`-based dedup, `InternalJobRun` idempotent cron dispatcher | **This is the pattern a Razorpay webhook receiver should reuse**: verify → dedup → enqueue → process idempotently — Kizunia already has this shape for a different reason (notification delivery) |
| Errors | `AppError` base class (`code`, `status`, `category`, `message`, `retryable`, `details`, `cause`) + wire-format `ApiError` (`code`, `category`, `retryable`, `details`) — ~20 module-specific error subclasses already follow this | Adding `SUBSCRIPTION_REQUIRED`/`PAYMENT_REQUIRED`/etc. (§52) is additive, not a new error architecture |
| Transactions | `prisma.$transaction` already used across ~15 services for multi-step consistency (e.g. notification generation's transactional outbox) | Same pattern applies to subscription state transitions; nothing new to invent |
| DB conventions | `cuid()` ids, `createdAt`/`updatedAt` on essentially every model, `deletedAt` + index used for soft-delete on some models | Usable directly for append-only subscription/grant history if that's the chosen model |
| **Audit log** | **No `AuditLog` model or service exists anywhere in the codebase** (confirmed via grep across `next/src` and `prisma/schema.prisma`) | Admin plan grants require "who/what/when/why/audit history" (§18, §53) — this is genuinely new ground, not a retrofit of an existing audit system |
| **Webhook infrastructure** | **No webhook receiver of any kind exists today.** The only externally-facing secret-gated endpoints are Kizunia-initiated internal cron/lifecycle routes (`x-internal-secret`, `CRON_SECRET` via `secretEquals`), which are a *different* trust model (infra secret, not a third-party signature) | HMAC signature verification, event-id dedup, and out-of-order-safe processing for Razorpay webhooks is net-new work — though it can be built as a thin adapter in front of the existing job-queue pattern above |

**Net implication:** nothing in the existing codebase is coupled to a payment provider today (correctly — no subscription code exists yet), so the provider-independence requirement (§39, §82) is trivially satisfiable *if* the entitlement resolver is built as the sole boundary before any billing code is written, exactly as the prior audit concluded in its own §25.12.

---

## 3. Razorpay Capability Research

### 3.1 Subscriptions & Plans — core model

A **Plan** is a reusable template: amount + billing `period`/`interval` (e.g. monthly, yearly). Plans are created via the Create Plan API and referenced by `plan_id`. **Monthly and yearly are two separate Plan objects**, not one plan with a switchable cycle — Razorpay has no "plan family" concept, so the product doc's instruction not to assume monthly/yearly are separate *domain* products (§14) is a Kizunia-side modeling choice layered on top of two Razorpay Plan objects underneath.

A **Subscription** is created against a `plan_id` with `total_count` (number of cycles to bill), optional `start_at` (delay — used for trials), `addons` (one-off charges attached to the subscription), `notes`, and optional `offer_id`.
[Create Subscriptions](https://razorpay.com/docs/payments/subscriptions/create/) · [Create Plans](https://razorpay.com/docs/payments/subscriptions/create-plans/) · [Subscription entity](https://razorpay.com/docs/api/payments/subscriptions/entity/) · [Subscriptions APIs](https://razorpay.com/docs/payments/subscriptions/apis/)

**Full Subscription entity fields (confirmed from the entity doc):** `id`, `plan_id`, `customer_id`, `status`, `quantity`, `total_count`, `paid_count`, `remaining_count`, `current_start`, `current_end`, `charge_at`, `start_at`, `end_at`, `ended_at`, `customer_notify`, `expire_by` (defaults to 30 years out), `auth_attempts`, `notes`, `offer_id`, `short_url`, `has_scheduled_changes`, `change_scheduled_at` (`now`/`cycle_end`).

**Available operations:** Create/Fetch Plan, Create/Fetch/Fetch-all Subscription, Create Subscription Link, Update Subscription, Fetch Pending Update, Cancel an Update, Pause, Resume, Cancel, Fetch Invoices.
[Subscriptions APIs list](https://razorpay.com/docs/payments/subscriptions/apis/)

### 3.2 Lifecycle states — mapped, not assumed 1:1

| Razorpay status | Entered when | Billing behavior | Access implication for Kizunia |
|---|---|---|---|
| `created` | Subscription object created, awaiting customer auth | No charge yet | No entitlement yet |
| `authenticated` | Customer completes the authentication/mandate transaction (or trial `start_at` hasn't arrived yet) | No recurring charge yet (trial window) | Entitlement can be granted (trial) even though no money moved |
| `active` | Billing cycle begins, first charge attempted | Regular scheduled charges | Full entitlement |
| `pending` | An auto-charge fails | Invoices keep generating; Razorpay auto-retries (see §3.5) | **This is where Kizunia's own grace-period clock should start** |
| `halted` | All auto-retries exhausted | Invoices keep generating; no further auto-charge attempted; requires customer/merchant manual action | Kizunia's grace clock may or may not have expired yet by this point — the two are not synchronized |
| `paused` | Explicit Pause API/Dashboard call, only from `active` | No auto-charge | Product decision, not forced by Razorpay |
| `cancelled` | Explicit cancel (immediate or cycle-end) | Terminates | **Terminal — cannot be restarted; a later resubscribe is a brand-new Subscription object with a new ID** |
| `expired` | `start_at` deadline passed without authentication | N/A | Terminal, never activated |
| `completed` | `end_date`/`total_count` cycles reached | Terminates | Terminal |

[Subscription States](https://razorpay.com/docs/payments/subscriptions/states/) · [Subscriptions Webhook Events](https://razorpay.com/docs/webhooks/subscriptions/)

**Mapping note (do not treat as 1:1):** Razorpay has no `trialing` status — a trial is just the `authenticated` state before `start_at` arrives. Razorpay also has no native "grace period" status — `pending`/`halted` describe *Razorpay's own retry effort*, not an entitlement policy. Kizunia's richer state model (§43 of the product doc: Active/Trialing/Past Due/Grace Period/Cancelled/Expired) must be derived by Kizunia from these six-ish raw signals plus its own clocks — it is not something Razorpay hands over ready-made.

**Important asymmetry:** once `cancelled`, a subscription cannot be reactivated — any later re-subscribe creates a new Razorpay `subscription_id`. This directly reinforces the product doc's own instinct (§54, §56) that **Kizunia's internal subscription/entitlement history must be the authoritative historical record** — a user's Free→Pro Trial→Pro→Pro+→Pro→Free journey (§54 example) will span multiple, unrelated Razorpay subscription IDs, not one continuous Razorpay object.

### 3.3 Coupons / Discounts / Offers — the most consequential finding

**Razorpay "Offers" are structurally not what the product document means by "coupon."** This single fact should shape the coupon architecture more than anything else in this report.

- Offers (both the generic Payment-Link/Checkout kind and the Subscription kind) are **created exclusively via the Dashboard** — there is no API to create an Offer object programmatically. [Create Subscription Offers](https://razorpay.com/docs/payments/subscriptions/offers/create/) · [Create Offers (generic)](https://razorpay.com/docs/payments/offers/create/)
- Generic (non-subscription) Offers auto-apply based on the **payment method/instrument** the customer selects at checkout (e.g. "10% off with a specific bank's cards") — there is no "customer types a text code" flow in Standard Checkout/Payment Links. [About Offers](https://razorpay.com/docs/payments/offers/)
- **Subscription Offers** are the relevant mechanism for Kizunia: discount type **Flat** or **Percentage** (percentage supports a merchant-set maximum cap amount), duration type **Single Use**, **Limited number of cycles**, or **Forever**. [About Subscription Offers](https://razorpay.com/docs/payments/subscriptions/offers/)
- A Subscription Offer is attached via the `offer_id` parameter **at Subscription-creation time** (confirmed parameter on the Create Subscription API). The Link-Offer API's own constraints reveal: offer currency must match plan currency, the discounted amount can't fall below the minimum payable amount, and there is an **offer-to-plan eligibility list** (so plan-restricted coupons are natively supported) plus a payment-method scope and a validity window. Nothing in the documentation describes attaching or changing an offer on an **already-active** subscription — it reads as creation-time-only, though this isn't explicitly ruled out either (flagged as an open question, §6). [Link an Offer to a Subscription](https://razorpay.com/docs/api/payments/subscriptions/link-offer/)
- Razorpay enforces **Max Usage** and **Max Usage Per Card** at the offer level, plus start/expiry dates — but these are Razorpay-instrument-scoped counters (cards/UPI handles), not Kizunia-user-account-scoped. Razorpay has no idea which Kizunia user is redeeming an offer.

**Mapping the document's specific coupon requirements:**

| Kizunia requirement | Razorpay native support | How it would work | Limitation |
|---|---|---|---|
| 10% / 50% / 99% off (percentage) | Yes — Percentage discount type | Pre-create a Subscription Offer per discount shape in the Dashboard; pass its `offer_id` at subscription creation | Not created dynamically per code — see catalog workaround below |
| ₹100 off (flat) | Yes — Flat discount type | Same as above with Flat type | Same catalog limitation |
| 99% off first month, normal price after | **Yes, natively** | Percentage=99, duration="Limited number of cycles"=1, linked via `offer_id` at creation. Razorpay automatically bills full price from cycle 2 with no Kizunia intervention | None significant — this is the cleanest mapping in the whole coupon space |
| First N billing periods discount | Yes | Same mechanism, cycles=N | Same catalog limitation |
| Free billing period / free plan for a duration (e.g. `FREEPRO30`) | **Not applicable — should never touch Razorpay at all** | Model as an entitlement grant (source=`COUPON`), structurally identical to an Admin Grant, no Razorpay subscription created | N/A — this is a Kizunia-only feature, not a billing discount |
| Plan-specific coupons | Yes | Offer has a plan-eligibility list | Not independently confirmed whether the list supports multi-plan sets vs. a single plan |
| Expiration date | Yes | Offer validity window (Dashboard-set) | Razorpay-enforced, but expiry is a property of the pre-created Offer, not of an arbitrary code Kizunia mints at runtime |
| Redemption limits | Yes, but instrument-scoped | Max Usage / Max Usage Per Card | **Not user-account-scoped** — cannot express "this Kizunia user may redeem once" on Razorpay's side |
| User-specific coupons | **No** | N/A | Must be entirely Kizunia-side: validate eligibility in Kizunia's DB *before* ever calling Razorpay with an `offer_id` |
| Global promotional coupons | Yes (loosely) | One Offer, no per-customer restriction | Still instrument-scoped, not identity-scoped |
| Coupon stacking | **No evidence of support** | N/A | Treat as unsupported; if the product ever needs it, Kizunia must pre-compute a single combined discount and provision one matching Offer, or handle it as a manual invoice adjustment outside the Offer system |

**The critical architectural conclusion:** Razorpay cannot be the source of truth for *whether* a given Kizunia user is eligible for a given coupon — it has no concept of a Kizunia account. **Kizunia must own 100% of coupon code parsing, eligibility checking, and redemption-limit tracking**, and only use a Razorpay `offer_id` as the final, narrow mechanism to make an *already-approved* discount physically apply to a real recurring charge. This matches the product document's own instinct (§19‑§21) almost exactly, and Razorpay's constraints make it the *only* safe design — not just a stylistic preference.

### 3.4 Free Trials

The only documented trial mechanism: pass a **future `start_at`** when creating the Subscription. The customer completes the authentication/mandate transaction immediately (so a payment method **is** collected up front), but the first charge doesn't fire until `start_at`. [Create Subscriptions — trial example](https://razorpay.com/docs/payments/subscriptions/create/)

Direct answers to the document's open trial questions (§22, §75):

| Question | Razorpay answer |
|---|---|
| Native free trial support? | Yes, via delayed `start_at` — but always with upfront mandate/authentication |
| Configurable duration? | Yes — any `start_at` in the future |
| Payment method required before trial starts? | **Yes** — this is not optional in Razorpay's model. There is no "trial with no card/mandate until conversion" |
| Automatic conversion vs. explicit action? | **Automatic** — since authorization already happened, Razorpay will charge at `start_at` unless Kizunia proactively cancels beforehand. The document's framing of "whether a trial automatically converts" (§22) should be read as "whether Kizunia lets it auto-convert or intervenes to cancel first," not as a Razorpay-configurable toggle |
| Trial-specific webhook/state? | **No.** No `trialing` status exists in the enum; the trial window is just `authenticated` before `start_at`. No trial-specific webhook event is documented — ordinary `subscription.authenticated`/`subscription.activated` events apply |
| Multiple trials prevented by Razorpay? | **No.** Razorpay has no concept of "this person already had a trial" — it only sees `customer_id`/subscription objects |
| What Kizunia must own | Trial eligibility (has this Kizunia account had a trial before), the decision to auto-convert or cancel-before-charge, and what happens to the resulting Free/Pro state after — none of this exists on the Razorpay side |

**Potential conflict worth flagging now (see §5 below):** if the product later wants a true no-payment-method trial (browse Pro free for 30 days with zero card/UPI setup), that **cannot** be built as a native Razorpay subscription-in-trial — it would have to be a purely Kizunia-side grant (indistinguishable in mechanism from an Admin Grant or a `FREEPRO30` coupon), with a **separate, new** Razorpay subscription created only if/when the user actually decides to pay.

### 3.5 Failed Payments & the 7-Day Grace Period

Razorpay retry behavior differs by payment rail:

- **Cards & UPI:** on failure at day T, auto-retries at T+1, T+2, T+3 (three retries across three days), then moves to `halted`.
- **e-Mandate/e-NACH:** retries depend on bank response (can exceed 24h per attempt), and shift around bank holidays (T‑1 or T‑3 if T/T‑1 are holidays).

[Payment Retries](https://razorpay.com/docs/subscriptions/handling-retries)

**There is no native, configurable grace period in Razorpay.** `pending` and `halted` describe only whether Razorpay is still attempting to collect money — they carry no entitlement semantics whatsoever. Razorpay's own docs contain no mention of a grace-period concept.

**Direct answer to the document's core question:** *Can Kizunia safely implement its own 7-day entitlement grace period on top of Razorpay's billing state?* **Yes**, and it is the only correct design — Razorpay does not offer anything Kizunia could instead delegate to. Conceptually:

```
Payment fails (first failure — payment.failed / subscription enters "pending")
        ↓
Kizunia starts its own 7-day grace clock (independent of Razorpay's internal retry cadence)
        ↓
Razorpay auto-retries for ~3 days (cards/UPI) or longer (e-mandate) — this happens INSIDE Kizunia's 7-day window, not after it
        ↓
Razorpay reaches "halted" (retries exhausted) — this can occur well before Kizunia's day 7
        ↓
Kizunia's grace period continues counting from the ORIGINAL failure, independent of whether Razorpay is pending or already halted
        ↓
Day 7: if unresolved (no subscription.charged since the failure), Kizunia changes access per its own policy
        ↓
If subscription.charged arrives at any point before day 7 → Kizunia clears the grace period immediately
```

The key modeling decision: **the grace-period clock should start at the first payment failure, not at Razorpay's `halted` transition**, because `halted` can arrive anywhere from ~3 days (cards/UPI) to longer (e-mandate, holiday-shifted) after the original failure — anchoring to `halted` would make the *effective* grace period inconsistent across payment methods, while anchoring to the first failure keeps it exactly 7 days regardless of rail. This also means Kizunia's 7 days comfortably absorbs the retry-timing variance between payment methods noted in §3.6.

### 3.6 Upgrades & Downgrades

Update Subscription API supports changing `plan_id`/`quantity`, either **immediately** or **at cycle end** (merchant's choice per call). [Update a Subscription](https://razorpay.com/docs/payments/subscriptions/update/)

- **Upgrade:** Razorpay generates a prorated invoice and charges the difference.
- **Downgrade:** the documentation describes this as potentially requiring the merchant to **issue a refund** for the difference — proration is not symmetric/fully-automatic in both directions.
- A minimum prorated-difference threshold applies (documented as at least 50 minor currency units, e.g. $0.50-equivalent) — updates below that threshold are rejected by the API.
- Cancellation: `cancel_at_cycle_end` boolean (default `false` = immediate). Cannot cycle-end-cancel a subscription that hasn't started its first billing cycle yet, or one already in its final cycle — must use immediate cancellation in those edge cases. [Cancel a Subscription](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/)
- Pause/Resume exist as explicit, separate operations, only from `active`. [Pause, Resume, Cancel](https://razorpay.com/docs/payments/subscriptions/pause-resume-cancel/)

**Product access change vs. billing change — the document deliberately separates these (§13, §45), and Razorpay's API supports that separation cleanly:** Razorpay's `now`/`cycle_end` toggle only controls *when Razorpay bills the difference*. It does not force Kizunia's entitlement layer to change access on the same timeline. Kizunia is free to, for example, grant Pro+ access immediately on user request while telling Razorpay to bill the difference at cycle end — or the reverse (wait for `subscription.updated`/a successful charge before granting access). Razorpay imposes no constraint here; **this remains exactly the open product decision the document already flags** (§84 "Upgrade timing", "Downgrade timing"), not something this research resolves.

### 3.7 Webhooks & Reliability

- **Signature verification:** HMAC-SHA256 over the **raw** request body using a webhook secret (set in Dashboard, distinct from API keys), hex-encoded, delivered in the `X-Razorpay-Signature` header. Parsing the body before verifying breaks the signature check — the raw bytes must be used. [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/)
- **Deduplication:** `x-razorpay-event-id` header, unique per event — the natural idempotency key.
- **Delivery model:** at-least-once, exponential backoff retries for up to 24 hours if the endpoint fails to acknowledge (including a >5s response-time timeout being treated as failure) — handlers must ack fast and do real processing asynchronously.
- **Ordering:** not documented as guaranteed. Handlers must not assume webhooks arrive in the order events occurred.
- **Reconciliation:** Razorpay's own recommended pattern is explicit — *rely on webhooks for automation generally, but perform an immediate API fetch of the authoritative entity when a user-facing flow needs instant/certain status.* [Webhooks overview](https://razorpay.com/docs/webhooks/)

**Direct implication for the document's reliability requirements (§40‑§42):** every one of the explicitly required properties (idempotency, dedup, out-of-order safety, missing-webhook recovery, reconciliation, safe partial failure) has a corresponding Razorpay-side gap that Kizunia must fill — Razorpay gives the raw materials (signed events, an event id, and a fetch-by-id API) but does none of the reliability work itself. Fortunately, **Kizunia already has a matching architectural pattern** for a different feature: the Postgres-backed job queue with `occurrenceKey` dedup and the transactional-outbox style used in `NotificationGenerationService`. A webhook receiver should follow the identical shape: verify signature → check `x-razorpay-event-id` against a dedup record → enqueue a job (don't process inline) → job handler re-fetches the authoritative Subscription/Payment entity by ID → applies the resulting state transition inside a `prisma.$transaction`. This is not a new architecture to invent, it's the existing one reused.

### 3.8 Payment Methods for Recurring Payments (India)

| Method | Mandate setup | Best fit | Failure characteristics |
|---|---|---|---|
| **UPI AutoPay** (UPI 2.0) | Real-time, customer authorizes via UPI PIN | Best success rates; best for sub-₹15,000 tickets, especially sub-₹500 | Fastest retry cadence (T, T+1, T+2, T+3) |
| **e-NACH / e-Mandate** | Bank-verified, can take days to activate | Needed above ~₹15,000 ticket size, or when no recurring-capable card exists | Retry timing bank-dependent, can exceed 24h, shifts around holidays |
| **Cards** (tokenized recurring mandate) | Standard card auth | Broadly available fallback | Most prone to failure from expiry/limit/issuer declines |

[UPI AutoPay / e-Mandate comparison](https://razorpay.com/blog/cheapest-payment-gateway-for-recurring-billing-e-nach-upi-autopay-and-subscription/) · [e-Mandate](https://razorpay.com/e-mandate/)

Given Kizunia's INR pricing and likely sub-₹15,000 Pro/Pro+ price points, **UPI AutoPay is the expected dominant rail**, with cards/e-mandate as fallback. Retry timing genuinely differs by rail — reinforced conclusion from §3.5: a 7-day Kizunia-side grace period is generous enough to absorb this variance regardless of which method a given customer used.

### 3.9 One-Time Payments (future scope — portfolio themes etc.)

Structurally separate object model from Subscriptions: an **Order** (amount + currency) is created, the customer pays via Checkout, and Razorpay creates a **Payment** against that order — guaranteed at most one successful payment per order. [Orders API](https://razorpay.com/docs/api/payments/orders/)

- **Capture:** configurable auto vs. manual (Dashboard default or per-Order via `capture_options`, which take precedence over Dashboard settings). Manually-captured payments must be captured within 3 days of authorization or Razorpay auto-refunds them. [Payment Capture Settings](https://razorpay.com/docs/payments/payments/capture-settings/)
- **Refunds:** standard Refund API against a captured payment.
- **Addons** (mentioned on the Subscription entity) are a *different*, subscription-scoped concept — a one-off charge tacked onto a subscription's next invoice (e.g. a setup fee) — not the same primitive as an independent one-time digital-product purchase. Do not conflate the two.

**Direct answer to the document's §35‑§36 framing:** one-time purchases map cleanly onto **Razorpay Orders/Payments for the charge + Kizunia-owned purchase/ownership record for the entitlement**, exactly as the product document already anticipates ("Free plan + purchased portfolio theme"). Razorpay should never be asked to represent "this user owns this theme" — that is a Kizunia-only record, created only after Kizunia verifies the payment via webhook + authoritative fetch (same pattern as §3.7).

---

## 4. Classification: Razorpay-Dependent / Kizunia-Owned / Hybrid

### Razorpay-dependent (do not reimplement)
- Actual recurring payment collection and mandate execution (UPI AutoPay / e-mandate / card)
- Payment authorization, 3DS, bank/network communication
- The literal execution of retry attempts
- Real-world subscription/payment lifecycle signals as experienced by the payment network (`pending`/`halted`/`charged`)
- One-time payment capture and refund execution
- Emission of billing-event webhooks and the authoritative Subscription/Payment/Order entities

### Kizunia-owned (must never depend on Razorpay availability)
- Effective entitlement resolution (plan/grant/trial/coupon → capability + quota)
- Project/portfolio/notification/MCP authorization decisions (existing architecture, unchanged)
- Project ownership counting and quota enforcement
- Portfolio "publicly displayable" state (independent of the user's own visibility preference)
- Notification preference vs. delivery-eligibility split
- MCP scope/capability authorization
- Admin authorization and admin grants — including duration, precedence, revocation, and audit trail
- Coupon code validation, per-user eligibility, and redemption-limit tracking
- Trial eligibility ("has this account had a trial before")
- Free-plan representation
- Subscription/entitlement history (Kizunia's own source-tagged event log — necessary precisely because Razorpay subscription IDs are not continuous across cancel/resubscribe, §3.2)
- The 7-day grace-period **policy** (Razorpay only supplies the raw failure/retry signal)
- Rate limiting and abuse-protection ceilings, including for "unlimited" plans
- The distinction between operational feature flags and subscription entitlements
- Purchase/ownership records for future one-time digital products

### Hybrid (both participate — split stated explicitly)
| Feature | Razorpay does | Kizunia does |
|---|---|---|
| Plan upgrade/downgrade | Executes the plan change + proration invoice via Update Subscription | Decides *when* the access change takes effect (now vs. cycle boundary) and records the transition |
| Coupons that discount a real recurring subscription | Executes the actual reduced/reverting billing via a pre-provisioned `offer_id` | Validates the code, checks eligibility, decides discount terms, chooses which pre-provisioned Offer maps to the code |
| Failed payments / grace period | Executes retries, reports `pending`/`halted` | Interprets those signals against its own 7-day clock to decide entitlement consequences |
| Cancellation | Executes immediate-vs-cycle-end billing termination | Decides what happens to data/entitlements (non-destructive) and when the resulting downgrade access-change applies |
| Webhook-driven state sync | Emits the signed event + authoritative entity | Verifies, dedups, reconciles via fetch, applies the entitlement change transactionally |
| One-time purchases | Executes charge/capture/refund | Owns the resulting purchase/ownership record and any entitlement it grants |

---

## 5. What Can Be Developed Safely Without Razorpay

Because the codebase already stubs `resolveEntitlements(actor)` (§2 above), everything **downstream** of that resolver can be built and fully tested today using admin-grant-equivalent fixtures, with no Razorpay dependency:

- Entitlement resolution logic itself (plan/grant/trial/coupon → capability + quota mapping)
- Project quota enforcement at the `ProjectService.create` seam
- Portfolio entitlement + the (still-undecided) public-visibility gating logic
- Notification entitlement gating (scheduler query + handler/delivery re-checks)
- MCP entitlement gating
- Admin grant CRUD and its audit trail (genuinely new — no existing audit system to build on, per §2)
- Non-destructive downgrade behavior for projects and portfolio
- Notification/competition preference survival across plan changes
- Structured subscription error codes (`SUBSCRIPTION_REQUIRED`, `PROJECT_LIMIT_REACHED`, etc.)
- The grace-period **state machine** itself (failure → grace → expiry) — this only needs to know "a failure happened at time T," which can be simulated without knowing anything about Razorpay's real retry cadence
- Coupon eligibility/redemption-limit logic against Kizunia's own database (entirely independent of whether the Razorpay `offer_id` mechanism is wired up)
- Trial eligibility logic ("has this account had a trial before")

### What should NOT be built against a simulated/fake Razorpay model

Building against an invented approximation here risks locking in wrong assumptions:

- **Exact retry timing before `halted`** — genuinely varies by payment method (§3.5, §3.8); a fake model would likely pick one number and the real 7-day grace-period sizing should be validated against actual UPI AutoPay/e-mandate retry behavior in test mode before launch, not assumed
- **Real proration math and the upgrade/downgrade refund asymmetry** — Razorpay's actual invoice/refund behavior on downgrade should not be guessed; test against the real API
- **Webhook payload shape and signature verification** — must be tested against Razorpay's real test-mode webhooks (raw-body HMAC is a common source of integration bugs); a hand-rolled fixture would likely get the raw-body requirement wrong
- **The Offer/coupon-to-Razorpay mapping** — since Offers are Dashboard-created only (§3.3), the actual catalog of `offer_id`s must be provisioned and exercised against Razorpay's real test dashboard; there is nothing meaningful to simulate here
- **UPI AutoPay / e-mandate mandate-registration UX and failure modes** — rail-specific behavior that has no faithful local substitute

---

## 6. Constraints That Could Force Product Changes

### Fully compatible
- Monthly + yearly billing for Pro/Pro+ (two Plan objects)
- Immediate vs. cycle-end cancellation (native toggle)
- Plan-specific coupons (Offer plan-eligibility list)
- First-N-cycles / forever discounts (native Offer duration types)
- **99% off first month** (Percentage=99 + Limited-cycles=1 Offer) — cleanest mapping found in this entire research pass
- Fixed-amount discounts (Flat Offer type)
- Upgrade/downgrade between paid plans (Update Subscription API)
- Pause/resume (native, from `active`)
- Reconciliation via authoritative fetch (Razorpay's own recommended pattern)

### Compatible with Kizunia-owned logic (Razorpay doesn't need to do this — and shouldn't)
- Free-plan representation (never needs a Razorpay object)
- Admin grants (never touch Razorpay)
- Coupons granting free access outright, e.g. `FREEPRO30` (never touch Razorpay — model as a grant, not a discount)
- The 7-day grace period as an entitlement policy (layered on top of `pending`/`halted`)
- Trial eligibility / one-trial-per-user (Razorpay has no such concept)
- Per-user coupon redemption limits (Razorpay's Max-Usage is instrument-scoped, not identity-scoped)

### Requires a workaround
- **Dynamic/self-serve coupon codes:** Offers are Dashboard-created only, no creation API. Workaround: pre-provision a bounded catalog of Offers per discount *shape* (`PERCENT_10`, `PERCENT_50`, `PERCENT_99_FIRST_CYCLE`, `FLAT_100`, …) and let Kizunia's coupon layer map arbitrary marketing codes onto that fixed catalog of `offer_id`s.
- **Applying a coupon to an already-active subscription:** `offer_id` reads as a creation-time-only parameter; documentation doesn't explicitly confirm or rule out attaching an offer later. A mid-cycle retention coupon likely requires either a manual one-off adjustment outside the Offer system, or cancel-and-recreate — **needs confirmation in Razorpay's test dashboard/support before this is assumed either way** (see open questions, §7).
- **Immediate access change with cycle-end billing change:** not a Razorpay limitation at all — Razorpay's `now`/`cycle_end` flag only controls billing timing; Kizunia's entitlement layer is free to move on a different clock. Listed here only because it's easy to wrongly assume the two must move together.

### Potential conflict
- **A true no-payment-method trial** (browse Pro with zero card/UPI setup) directly conflicts with Razorpay's only documented trial mechanism, which requires upfront authentication (§3.4). If the product wants this, it cannot be a Razorpay subscription-in-trial at all — it must be a Kizunia-only grant, with a *separate* new Razorpay subscription created only at actual conversion. This is a real product decision to make, not a technicality.
- **Coupon stacking** on the billing side has no evidence of native support. If ever required, Kizunia must pre-compute one combined discount and provision a single matching Offer (or handle it as a manual invoice adjustment) — stacking multiple live Offers on one subscription is not something to assume works.
- **Downgrade proration "refund":** if the product wants downgrades to be billing-neutral (no refund/credit logic at all, purely an access change at the next cycle boundary), that maps better to a **cycle-end-effective** Update Subscription call than an immediate one, since immediate downgrades appear to trigger Razorpay's refund-style proration path. Worth deciding deliberately rather than defaulting into whichever behavior the "immediate" flag happens to produce.

---

## 7. Explicit Answers to the Pointed Questions

1. **Can Razorpay support Pro/Pro+ monthly and yearly subscriptions?** Yes — two separate Plan objects (one per plan × cycle combination), referenced by `plan_id` at Subscription creation.
2. **How should Kizunia represent Free from Razorpay's perspective?** It shouldn't be represented in Razorpay at all — no Plan/Subscription object should exist for Free users. This mirrors the document's own open question (§56) and Razorpay's model doesn't push toward either "implicit Free" or "explicit Free row" — that remains a purely Kizunia-side decision.
3. **Can Kizunia grant Pro/Pro+ without Razorpay?** Yes, entirely — admin grants never need to touch Razorpay, and the codebase's entitlement seam is already structured to make the access-source irrelevant to feature enforcement.
4. **Can Kizunia implement a 7-day entitlement grace period independently of Razorpay?** Yes — this is the only viable design, since Razorpay offers no grace-period concept of its own (§3.5).
5. **How exactly can we achieve "99% off first month"?** Native Subscription Offer: Percentage=99, duration="Limited number of cycles"=1, linked via `offer_id` at subscription creation; Razorpay automatically reverts to full price at cycle 2 (§3.3, §3.6).
6. **Can Razorpay support coupons directly, or should Kizunia own coupon eligibility and translate into a billing configuration?** The latter, and not as a stylistic choice — Razorpay's Offers are Dashboard-provisioned and instrument-scoped, not identity-aware or dynamically creatable. Kizunia must own eligibility/validation and translate an approved coupon into a pre-provisioned `offer_id` (§3.3).
7. **Can Razorpay support free trials matching our requirements?** Partially — native trials work via delayed `start_at`, but always require upfront payment-method authorization, and always auto-convert unless Kizunia intervenes. A no-payment-method trial is not natively supported (§3.4, §6).
8. **Can Razorpay support upgrades/downgrades between plans?** Yes, via Update Subscription, immediate or cycle-end, with Razorpay-side proration — though downgrade proration may require a merchant-initiated refund rather than being fully automatic (§3.6).
9. **What happens when a recurring payment fails?** `active` → `pending` (auto-retry per payment-method-specific schedule) → `halted` if retries are exhausted; invoices keep generating throughout; no entitlement consequence is decided by Razorpay (§3.5).
10. **Can Kizunia safely determine effective entitlements independently from Razorpay?** Yes — this is required regardless, since Razorpay has no concept of Kizunia's feature/quota model at all; the existing `resolveEntitlements()` seam already assumes this.
11. **What information should come from Razorpay into Kizunia?** Subscription/Payment/Order lifecycle status and identifiers, via verified webhooks confirmed by an authoritative API fetch (§3.7) — raw billing facts only.
12. **What information should never come from Razorpay directly into feature authorization?** Any `razorpayPlanId`/`razorpaySubscriptionId`/`razorpayPaymentId` value used directly in a feature-gating `if` — per the document's own §39/§82 rule, which nothing in Razorpay's model requires violating.
13. **Can one-time purchases coexist cleanly with subscriptions?** Yes — Orders/Payments is a structurally separate object model from Plans/Subscriptions; a purchase should produce a Kizunia-owned ownership record, not touch subscription state at all (§3.9).
14. **Which requirements should be implemented before Razorpay integration?** Everything listed in §5 above — the entire entitlement resolution layer, quota/portfolio/notification/MCP gating, admin grants, and the grace-period state machine, all buildable and testable against fixtures today.
15. **Which requirements should wait until Razorpay integration is understood further?** Exact retry-timing validation for grace-period sizing, real proration behavior, webhook payload/signature testing, and the coupon-Offer catalog provisioning — all listed in §5's "should not be simulated" list.
16. **Are there product decisions that should be reconsidered because of Razorpay limitations?** Two candidates, both already open decisions in the source document rather than settled ones: (a) if a *true* no-payment-method trial is wanted, it cannot be a native Razorpay trial and needs a different mechanism (§3.4, §6); (b) if downgrades are meant to be billing-neutral, cycle-end (not immediate) Update calls are the better default to avoid triggering refund-style proration (§6).

---

## 8. Open Questions Before Architecture Design

These need direct confirmation (via Razorpay test mode or support) before they can be assumed either way — the documentation was ambiguous or silent on each:

- Can an Offer be linked to an **already-active** subscription, or is `offer_id` strictly a creation-time parameter? (§3.3)
- Can a Subscription Offer be configured with **no payment-method restriction** (applies regardless of card/UPI/e-mandate), or is some restriction always required?
- What is the real-world retry duration for e-mandate under Indian banking holidays, specifically to confirm the 7-day grace period is comfortably sufficient across all supported rails (§3.5, §3.8)?
- What is the exact minimum-currency-unit threshold for a proration update to be accepted, and how should a rejected too-small upgrade/downgrade be surfaced to the user?
- What does Razorpay's test-mode webhook tooling actually provide for pre-production verification of signature/payload handling?

These, together with the already-open product decisions in §84 of the source document (unchanged and un-reinterpreted by this report), are the inputs the next architecture phase needs before schema/API design begins.

---

## 9. Sources

- [Create Subscriptions](https://razorpay.com/docs/payments/subscriptions/create/)
- [Create and View Plans](https://razorpay.com/docs/payments/subscriptions/create-plans/)
- [Subscriptions APIs](https://razorpay.com/docs/payments/subscriptions/apis/)
- [Subscription Entity](https://razorpay.com/docs/api/payments/subscriptions/entity/)
- [Subscription States](https://razorpay.com/docs/payments/subscriptions/states/)
- [Payment Retries](https://razorpay.com/docs/subscriptions/handling-retries)
- [Subscriptions Webhook Events](https://razorpay.com/docs/webhooks/subscriptions/)
- [Update a Subscription](https://razorpay.com/docs/payments/subscriptions/update/)
- [Cancel a Subscription](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/)
- [Pause, Resume and Cancel a Subscription](https://razorpay.com/docs/payments/subscriptions/pause-resume-cancel/)
- [About Subscription Offers](https://razorpay.com/docs/payments/subscriptions/offers/)
- [Create Subscription Offers](https://razorpay.com/docs/payments/subscriptions/offers/create/)
- [Link an Offer to a Subscription](https://razorpay.com/docs/api/payments/subscriptions/link-offer/)
- [About Offers (generic)](https://razorpay.com/docs/payments/offers/)
- [Create Offers (generic)](https://razorpay.com/docs/payments/offers/create/)
- [Webhooks overview](https://razorpay.com/docs/webhooks/)
- [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/)
- [Orders API](https://razorpay.com/docs/api/payments/orders/)
- [Payment Capture Settings](https://razorpay.com/docs/payments/payments/capture-settings/)
- [e-Mandate](https://razorpay.com/e-mandate/)
- [UPI AutoPay / e-NACH / card recurring-billing comparison (Razorpay blog, secondary)](https://razorpay.com/blog/cheapest-payment-gateway-for-recurring-billing-e-nach-upi-autopay-and-subscription/)

Secondary sources are labeled inline where used; all other citations are official Razorpay documentation (`razorpay.com/docs/...`).

---

## 10. Document Status

This is a research and feasibility deliverable, not the technical architecture. No open product decision from `suscriptions.md` has been closed here — where Razorpay's behavior bears on an open decision (trial payment-method requirement, grace-period anchoring, downgrade proration timing), this report states the constraint and leaves the decision open, per instructions. The next step is architecture design, informed by this document plus `docs/temp/kizunia-authorization-compressed-wind.md` and the original product decisions document.
