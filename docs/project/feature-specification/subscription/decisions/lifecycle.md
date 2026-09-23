# Rulings — Lifecycle

> **Status:** Live
>
> **Last Updated:** 2026-09-24

---

## SB-LC-01 — Trial is Razorpay-native only

**Status:** Accepted

**Decision:** Trials use Razorpay's native mechanism — a subscription created with a future
`start_at`, with the authorization/mandate transaction completed immediately. There is no separate
Kizunia-built, no-payment-method trial system.

**Rationale:** [RAZORPAY FACT] Razorpay has no native concept of a card-free trial: the customer
must complete authentication (mandate setup) at trial start regardless of when the first real
charge happens (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#trials)).
Building a separate no-card trial engine — as the original product doc left open as a possibility
(`suscriptions.md` §84) — would mean maintaining a second subscription-like state machine solely
for the pre-payment period, then migrating the user into the real one at conversion. Aligning
trials with the mechanism Razorpay already provides removes that entire second system: "conversion"
becomes nothing more than the ordinary `subscription.activated`/`subscription.charged` webhook path
that every paid subscription already goes through.

**Consequence:** A trial cannot be offered without the user providing a payment method up front.
This is an accepted product trade-off, not an oversight — see
[`../open-decisions.md`](../open-decisions.md) for what remains genuinely undecided about trials
(repeat trials, cooldowns).

## SB-LC-02 — Upgrades are immediate

**Status:** Amended — 2026-09-24, see below and [SB-LC-07](#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)

**Decision:** Plan upgrades (Free→Pro, Pro→Pro+) apply immediately, using Razorpay's
`schedule_change_at: "now"`. Razorpay automatically generates a prorated invoice and charges the
difference.

**Rationale:** [RAZORPAY FACT] Razorpay's Update Subscription API supports immediate plan changes
with automatic proration on the charge side (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade--downgrade)).
Immediate upgrade is standard SaaS practice, gives the user immediate value for money already
committed to paying, and requires no Kizunia-side proration logic — Razorpay computes and charges
the difference on its own.

**Amended (2026-09-24):** Three corrections, the ruling's intent — immediate, Razorpay-prorated,
no Kizunia proration — unchanged:

1. **Free→Pro is not an upgrade.** A Free user has no Razorpay subscription to update; buying a plan
   is a *creation*, governed by [SB-UQ-02](uniqueness-and-resubscription.md#sb-uq-02--kizunia-never-creates-a-second-open-subscription-for-a-user)
   and [SB-CM-02](commands-and-idempotency.md#sb-cm-02--the-local-record-is-written-before-the-provider-call).
   This ruling covers paid→paid upgrades (Pro→Pro+, and a cycle change that raises the price).
2. **Only where Razorpay can do it.** [RAZORPAY FACT] Update is refused for UPI and e-mandate
   subscriptions, and domestic-card subscriptions can only change their Offer
   ([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade--downgrade)).
   An immediate upgrade is therefore available only for subscriptions Razorpay can update; everywhere
   else it is a documented V1 limitation — see [SB-LC-07](#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible).
3. **Access follows the synced provider plan, not the request.** Higher-tier access begins when an
   authoritative sync (the Update response itself, applied per
   [SB-CM-05](commands-and-idempotency.md#sb-cm-05--command-responses-are-applied-through-the-same-path-as-synchronization),
   or the `subscription.updated` refetch) shows the new plan. [RAZORPAY FACT] "If the charge fails,
   the Subscription is not updated" — a failed proration charge leaves the user on the old plan, and
   Kizunia grants nothing speculatively.

See [R-06](reconciliations.md#r-06--the-update-api-does-not-support-plan-changes-for-most-indian-payment-methods).

## SB-LC-03 — Downgrades take effect at cycle end

**Status:** Amended — 2026-09-24, see below and [SB-LC-07](#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)

**Decision:** Plan downgrades (Pro+→Pro, Pro→Free) use `schedule_change_at: "cycle_end"`. The user
keeps current-plan access and billing until the paid period ends, then the lower plan applies.

**Rationale:** [RAZORPAY FACT] Razorpay's own documentation describes downgrade proration as
requiring a merchant-initiated refund for the difference when applied immediately, and explicitly
forces `cycle_end` timing for any subscription with an active Offer (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade--downgrade)).
Defaulting every downgrade to `cycle_end` avoids building refund-issuing logic entirely, is
consistent behavior regardless of whether an Offer happens to be active, and matches common
subscription-system practice (the user already paid for the period; they keep what they paid for).
This directly resolves the original product doc's explicitly open downgrade-timing question
(`suscriptions.md` §44, §84).

**Amended (2026-09-24):**

1. **Pro→Free is a cancellation, not a plan update.** There is no Razorpay plan for Free. Leaving a
   paid plan is [SB-LC-04](#sb-lc-04--cancellation-defaults-to-end-of-cycle)'s cycle-end
   cancellation, which Razorpay supports for every payment method. This ruling covers paid→paid
   downgrades (Pro+→Pro, and a cycle change that lowers the price).
2. **Only where Razorpay can do it.** A native `cycle_end` update is used where Razorpay accepts it;
   where Razorpay refuses (UPI, e-mandate, domestic cards), the paid→paid downgrade is a documented
   V1 limitation with no Kizunia workaround — see [SB-LC-07](#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible).
   The cycle-end timing remains Razorpay-native behavior, not a Kizunia billing rule.
3. **Access follows the synced provider plan.** The lower plan applies when an authoritative sync
   shows it; no webhook is documented for a scheduled change being applied, so the change is
   observed by due-based synchronization at the scheduled time
   ([SB-RC-05](reconciliation.md#sb-rc-05--reconciliation-is-due-based-not-a-sweep)).

## SB-LC-04 — Cancellation defaults to end-of-cycle

**Status:** Amended — 2026-09-24, see the end of this ruling

**Decision:** Customer-initiated cancellation defaults to `cancel_at_cycle_end: true`. The user
keeps paid access through the period already paid for, then falls back to Free.

**Rationale:** [RAZORPAY FACT] `cancel_at_cycle_end` is a native, documented Razorpay parameter (see
[`../../../../architecture/subscription/provider-boundary/razorpay-facts.md`](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#cancellation)).
Standard SaaS practice, avoids any refund question, and is the behavior users expect by default.
Resolves the original product doc's explicitly open cancellation-timing question
(`suscriptions.md` §44, §84).

**Amended (2026-09-24):** [RAZORPAY FACT] Razorpay refuses a cycle-end cancellation when "no billing
cycle is going on" and when the subscription "is in its final cycle"
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#cancellation)).
Two customer cases are therefore defined explicitly rather than left to a provider error:

- **During a trial** (before the first billing cycle), customer cancellation is **immediate** and
  trial access ends at once — matching the product statement that cancelling during a trial "ends it
  immediately with no charge".
- **In a final cycle** (only reachable if a finite `total_count` is ever used), no cancellation is
  needed: the subscription completes at the cycle end by itself; the request is answered as such.

Pro→Free is always this ruling, never a plan update ([SB-LC-03](#sb-lc-03--downgrades-take-effect-at-cycle-end)).
A cycle-end cancellation cannot be revoked ([SB-LC-09](#sb-lc-09--a-requested-cycle-end-cancellation-cannot-be-undone)).

## SB-LC-05 — Immediate cancellation is an explicit admin/support action

**Status:** Accepted

**Decision:** `cancel_at_cycle_end: false` (immediate cancellation) remains available, but is
invoked deliberately (e.g. by support handling a specific case), not offered as the customer
self-serve default.

**Rationale:** Keeps the common path simple and refund-free ([SB-LC-04](#sb-lc-04--cancellation-defaults-to-end-of-cycle))
while not removing a capability Razorpay supports and support staff may legitimately need.

## SB-LC-06 — A Dashboard-originated change is a normal lifecycle path

**Status:** Amended — 2026-09-24, see below

**Decision:** Any subscription mutation performed directly in the Razorpay Dashboard (cancellation,
refund, other supported operations) is handled through the exact same webhook-driven pipeline as a
Kizunia-application-initiated change. It is never treated as an exceptional or unsupported case.

**Rationale:** Explicitly required by this design's source instructions: administrators have
Razorpay Dashboard access and are expected to use it operationally. A design that only accounts for
Kizunia-originated mutations would break the moment an admin cancels a subscription from the
Dashboard instead of through the app. See
[`../../../../architecture/subscription/lifecycle/dashboard-originated-changes.md`](../../../../architecture/subscription/lifecycle/dashboard-originated-changes.md).

**Amended (2026-09-24):** Scope widened to every change Kizunia did not issue. [RAZORPAY FACT] A
UPI AutoPay customer can cancel or pause their mandate from their own UPI app, reported through
`subscription.cancelled` / `subscription.paused`, and only the customer can resume a
customer-paused UPI subscription
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#payment-methods-and-customer-originated-changes)).
Such customer-originated changes go through the same synchronization pipeline, with no special case.
A change is attributed to Kizunia only when it matches a Kizunia `BillingOperation`
([SB-CM-01](commands-and-idempotency.md#sb-cm-01--every-mutating-provider-call-is-a-recorded-billing-operation));
otherwise its history cause is `provider_observed`, because Kizunia cannot tell a Dashboard operator
from a customer's UPI app.

## SB-LC-07 — Razorpay decides whether a plan change is possible

**Status:** Accepted — product decision, 2026-09-24

**Decision:** A paid→paid plan change (tier or billing cycle) is performed only through Razorpay's
native Update Subscription capability, with Razorpay's native proration and timing semantics
([SB-LC-02](#sb-lc-02--upgrades-are-immediate), [SB-LC-03](#sb-lc-03--downgrades-take-effect-at-cycle-end)).
Whether it is possible for a given subscription is decided by Razorpay:

- **Authoritative:** Razorpay's response. A refusal because of the payment method or the
  subscription's state is classified `REJECTED`, changes nothing locally, and is shown as "this plan
  change isn't available for your subscription" — never as a generic error and never retried.
- **Advisory, for UX only:** the payment method of the subscription's authorization payment
  (UPI / e-mandate / card, and whether the card is international), captured when the subscription is
  first synchronized after authentication. The UI hides or explains plan changes it expects Razorpay
  to refuse, but never *enforces* a restriction Razorpay itself does not.
- **Where Razorpay refuses:** Kizunia builds no workaround in V1 — no successor subscription, no
  Kizunia-computed proration, no refund. The user can cancel
  ([SB-LC-04](#sb-lc-04--cancellation-defaults-to-end-of-cycle)), keep access until the period ends,
  and buy the new plan once the old subscription has ended. This limitation is recorded as future
  scope ([`../future.md`](../future.md#plan-changes-razorpay-cannot-perform-natively)) and as open
  product question [B1](../open-decisions.md#b-genuinely-open-product-questions).

Plan changes are also unavailable while the subscription is `PAST_DUE`, `HALTED`, `PAUSED` or not
yet authenticated, because Razorpay refuses updates in those states.

**Rationale:** [RAZORPAY FACT] "Subscriptions cannot be updated when payment mode is UPI",
"…emandate", and "For Subscriptions created using domestic cards, you can update only the offer"
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#upgrade--downgrade)).
The product decision is to rely on Razorpay's billing behavior rather than reproduce it: a
successor-subscription workaround would reintroduce two concurrently open subscriptions, a second
mandate authorization, and Kizunia-side proration — exactly the duplicated billing machinery this
design rejects. Treating Razorpay's response as authoritative, rather than a Kizunia-side table of
which methods allow updates, means the capability widens automatically if Razorpay's rules change.
[RAZORPAY FACT] There is no `payment_method` field on the subscription entity, which is a second
reason the stored method can only ever be advisory.

**Consequence:** For the payment methods most Indian customers use, self-serve paid→paid plan
changes are unavailable in V1. This is deliberate and visible, not an oversight. See
[R-06](reconciliations.md#r-06--the-update-api-does-not-support-plan-changes-for-most-indian-payment-methods).

## SB-LC-08 — At most one scheduled change, and cancellation always wins

**Status:** Accepted

**Decision:** A subscription has at most one pending `cycle_end` plan change. A new plan-change
request while one is pending first cancels it through Razorpay's Cancel an Update API, confirmed by
sync, as part of the same command. A cancellation request while a plan change is pending cancels the
pending update first; the subscription then ends at cycle end on its current plan.

**Rationale:** [RAZORPAY FACT] Razorpay exposes "Cancel an Update" for pending `cycle_end` updates,
and an update cannot be cancelled "once it is live"
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#scheduled-changes)).
Stacking changes, or leaving a scheduled downgrade attached to a subscription that is ending anyway,
creates provider state nobody can reason about. Clearing it explicitly keeps the provider state equal
to exactly one user intent.

## SB-LC-09 — A requested cycle-end cancellation cannot be undone

**Status:** Accepted

**Decision:** Once a cycle-end cancellation has been requested, V1 offers no "resume" or "undo". The
user keeps access to the end of the period; to continue, they subscribe again after the subscription
has ended.

**Rationale:** [RAZORPAY FACT] No API to revoke a requested cycle-end cancellation is documented
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#cancellation)).
The only alternative is a successor subscription created before the old one ends — a workaround V1
deliberately does not build ([SB-LC-07](#sb-lc-07--razorpay-decides-whether-a-plan-change-is-possible)).
The cancellation confirmation step must say so plainly. Whether to offer undo later is open product
question [B5](../open-decisions.md#b-genuinely-open-product-questions).

## SB-LC-10 — Subscription kind is recorded at creation, never inferred

**Status:** Accepted

**Decision:** Every Subscription records its `kind` — `STANDARD` or `TRIAL` — when Kizunia creates
it. Phase `TRIALING` is assigned only to a `TRIAL` Subscription in Razorpay state `authenticated`
before its `start_at`. A `STANDARD` Subscription in `authenticated` never contributes access.

**Rationale:** [RAZORPAY FACT] Razorpay has no trial object; a trial is merely a future `start_at`
([razorpay-facts](../../../../architecture/subscription/provider-boundary/razorpay-facts.md#trials)).
Inferring "trial" from `authenticated` plus a future `start_at` — as the original state mapping did —
would grant free access to any future-start subscription, including one created from the Dashboard.
Only Kizunia knows it offered a trial, so only Kizunia's own record may say so.

## SB-LC-11 — One trial per account

**Status:** Accepted — product decision, 2026-09-24

**Decision:** A user is eligible to start a trial only if none of their Subscriptions of kind `TRIAL`
has ever reached `TRIALING`. Eligibility is derived from existing Subscription records (no separate
table) and checked inside the per-user command serialization
([SB-CM-01](commands-and-idempotency.md#sb-cm-01--every-mutating-provider-call-is-a-recorded-billing-operation)),
so two concurrent trial starts cannot both pass it. A trial that was cancelled, expired after
starting, or converted still consumes eligibility; a `TRIAL` checkout abandoned before authentication
does not.

**Rationale:** Without a rule, a user could cancel a trial (which is immediate, since Razorpay cannot
cycle-end-cancel before the first cycle) and start another indefinitely — unlimited free Pro.
[RAZORPAY FACT] Razorpay has no concept of a prior trial, so the rule can only live in Kizunia.
Deriving it from the Subscription records Kizunia already keeps avoids new state. Cooldowns or
re-trials remain open product question [B7](../open-decisions.md#b-genuinely-open-product-questions).
