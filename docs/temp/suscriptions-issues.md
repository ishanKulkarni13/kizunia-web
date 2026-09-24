## Reconciliation rate limiting consideration

The current reconciliation design correctly limits reconciliation to relevant, non-terminal subscriptions and avoids blindly fetching the subscription state of every Kizunia user. However, the design should also explicitly account for Razorpay API rate limits.

Reconciliation must not be implemented as an unbounded loop over eligible subscriptions. The architecture should define a bounded outbound request strategy, including appropriate batching/concurrency limits and backoff behavior when Razorpay responds with rate limiting (for example, HTTP 429).

The reconciliation process should be able to stop/defer remaining work when the provider request budget is exhausted and continue it in a later pass, rather than repeatedly retrying immediately or allowing one reconciliation run to generate excessive provider traffic.

This should also apply to webhook-triggered authoritative refetches so that reconciliation traffic and webhook processing do not independently exceed the provider's safe request capacity.

The exact limits, batch size, concurrency, backoff strategy, and whether a shared provider request budget is required should be determined during the architecture/implementation phase based on Razorpay's documented API limits.

Requirement: Razorpay synchronization must be bounded and provider-rate-limit-aware. Kizunia must never assume that it can fetch an arbitrary number of subscription states in a single reconciliation run.

## Multiple subscription / resubscription lifecycle consideration

The current design states that a user has one active Subscription at a time, while also deliberately preserving a HALTED Razorpay subscription so that it can recover later. The architecture must explicitly define the interaction between an existing recoverable/haltered subscription and creation of a new Razorpay subscription.

Example: a user's Subscription A becomes HALTED, Kizunia falls back to Free, and the user subsequently purchases a new Subscription B. If Subscription A later resumes to ACTIVE, Kizunia could have two provider subscriptions capable of contributing paid access.

Before implementation, define the invariant and lifecycle rules for this case:

whether a new subscription can be created while an existing subscription is HALTED or otherwise non-terminal
whether the old subscription should be cancelled, retained, or explicitly superseded
how Kizunia identifies the current/subordinate subscription relationship
how upgrades, downgrades, cancellations, Dashboard changes, and reconciliation behave when multiple provider subscriptions exist
what happens if an older halted subscription recovers after a newer subscription already exists
how duplicate billing/subscription creation is prevented during concurrent requests or retries

The implementation must not assume that one active Subscription per user is sufficient by itself. The invariant needs an explicit lifecycle and concurrency rule covering non-terminal provider subscriptions.