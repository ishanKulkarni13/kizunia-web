# Phase IX — LIVE Readiness

> **Status:** Not started
>
> **Depends on:** all earlier phases in launch scope · **Razorpay needed:** LIVE · **Old slice:** S17

## Objective

Resolve every **LIVE BLOCKER**, configure LIVE, and prove in a staging drill that billing can be switched on for real customers and operated safely. After this phase, LIVE billing can be enabled deliberately; before it, `disabled` or TEST is the only allowed state.

## Scope

**LIVE blockers to resolve** (each one is recorded as a fact or a ruling when resolved):

| Item | What is needed | Reference |
| --- | --- | --- |
| Launch scope | **Owner decision:** does LIVE launch wait for trials, Offers and Promotions (Phase VII)? | [settled decisions](../../implementation/settled-decisions.md#still-open-for-the-owner-not-blocking-before-the-named-phase) |
| Razorpay account rate limits | Ask Razorpay Support; set C1 (budget and headroom) from the answer | A12 |
| Alert delivery channel | Choose and wire one: Vercel log-drain alert, e-mail, or an in-app admin notice. `billing.alert` events already exist | [IB-11](../../implementation/open-decisions.md#ib-11--alerting-channel) |
| Tick cadence | An external pinger on the authenticated tick URL, or a Vercel plan with finer cron, reaching C6 (about 5 min, 15 min at most) | [IB-19](../../implementation/open-decisions.md#ib-19--tick-cadence-on-the-vercel-hobby-plan) |
| Pricing and the LIVE plan catalog | **Owner decision:** prices (B6). Create LIVE Plans (and Offers, if in scope) in the Razorpay Dashboard; fill the LIVE catalogs | B6, SB-PB-05 |
| UPI | UPI enabled on LIVE; the UPI behaviors in A16 verified (checkout, cancel, recovery, trials if in scope); the UPI recovery UX ruled | [IB-18](../../implementation/open-decisions.md#ib-18--upi-disabled-on-the-razorpay-test-account), [IB-22](../../implementation/open-decisions.md#ib-22--upi-recovery-ux) |
| TEMPORARY recommendations route | Remove `app/api/v1/me/recommendations/competitions/route.ts` (marked "must be removed before production") | [IB-2](../../implementation/open-decisions.md#ib-2--recommendation-gate-point) |

**Other readiness work:**

- LIVE webhook: register it with the SB-WH-08 event set and a LIVE secret; check the `account_id`.
- LIVE configuration: keys, the webhook secret, the account ID, and `BILLING_EXPECTED_MODE=live` in production. Boot validation passes.
- **Staging drill:** walk through every runbook procedure, including webhook secret rotation, key rotation, an outage (a forced cooldown), and restoring from the database.
- Launch messaging states the V1 limitations honestly:
  - no paid→paid plan change for UPI, e-mandate or domestic cards;
  - no undo of a cancellation;
  - cancelling while a payment is failing ends access immediately.
- A final documentation pass: status lines, Razorpay facts updated with LIVE observations.

## Architectural components involved

Configuration, catalogs, the provider budget, `billing.alert` delivery, the internal tick trigger, the runbook, the admin tools.

## Dependencies

Every phase in launch scope. At minimum I–VI and VIII. Phase VII only if the owner puts trials or codes in launch scope.

## Files and modules likely affected

- `modules/billing/config/*` (LIVE catalogs, C1–C7 values).
- Deployment configuration (environment variables, pinger or cron).
- The alert-channel integration.
- The TEMPORARY route deleted.
- Docs: `configuration.md`, `operations-runbook.md`, `razorpay-facts.md`, `open-decisions.md`.

## Database and schema work

None expected.

## Domain and application work

None new. Values are set, and the TEMPORARY route is removed.

## Provider work

- Razorpay Support for A12, and UPI enablement on LIVE.
- The first LIVE observations, recorded as facts: A7 (a real first post-trial charge), A10 (mandate revocation) and A11 (e-mandate retry timing) as they occur.

## Integration work

Alert channel, tick trigger, LIVE webhook, pricing page content.

## Authorization and entitlement implications

None new. Verify the IB-15 role mapping against the production admin roster.

## Concurrency and transaction considerations

Re-check the tick budget under production-like notification load. Confirm C1 against the Support-provided limits.

## Observability requirements

- `billing.alert` events reach the chosen channel, with a test alert proven end to end.
- The health endpoint is monitored.

## Testing requirements

- The staging drill, following the runbook.
- A LIVE smoke test: one real low-value subscription, created, observed and cancelled, by the owner or with the owner's approval.
- A regression run of all suites.

## Acceptance criteria

- [ ] Every LIVE blocker above is resolved and recorded, or explicitly waived by the owner with a reason.
- [ ] Production boots in `live` only with consistent LIVE configuration, and a TEST row can never grant access in production.
- [ ] An alert raised in staging reaches the chosen channel.
- [ ] The tick runs at the C6 cadence in production.
- [ ] UPI checkout and cancellation are verified in LIVE (or TEST), and the UPI recovery UX is ruled.
- [ ] The TEMPORARY recommendations route no longer exists.
- [ ] The runbook dry-run is completed and its findings are fixed.

## Explicit non-goals

- New features. Anything discovered here that needs a new capability becomes a post-V1 item.
- The switch/successor plan-change flow (DEFERRED, IB-21).
- The account-removal workflow (DEFERRED, IB-14).

## Decisions that must already be settled

- **Owner:** pricing (B6), launch scope, and the alert-channel choice (IB-11).
- **Operations:** the tick-trigger choice (IB-19).
- **Provider-dependent:** A12 and A16. These are resolved *within* this phase.

## Risks and blockers

- **Blocker:** Razorpay Support lead time for A12 and for UPI enablement. Request both early; neither needs code.
- **Risk:** UPI behaving differently from its documentation. The design classifies refusals by code and reads state only from fetches, so a difference changes UX copy or a ruling, not the architecture.

## Expected output

A production deployment able to run LIVE billing: LIVE configuration and catalogs, a working alert channel and tick cadence, UPI verified, the TEMPORARY route removed, a drilled runbook, and updated facts and rulings.
