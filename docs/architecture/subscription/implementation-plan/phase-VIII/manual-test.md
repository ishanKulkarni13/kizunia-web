# Phase VIII — Admin Billing Tools Verification Runbook

> **Status:** Automated coverage complete (see the [phase record](README.md#implementation-record)). Every scenario below is a **manual** check and is **UNVERIFIED** until a row is added to [§5](#5-current-verification-status).
>
> **Applies to:** the Phase VIII admin tools ([phase README](README.md)) · **Mode:** Razorpay **TEST** (the tools themselves read and write only Kizunia's tables, apart from the Phase IV sync now and Phase VI immediate cancel they host)

Phase VIII adds no provider behavior. The tests prove Kizunia's own logic against a real database and the fake provider; this runbook checks what a person sees in the real admin UI, against the dev database and Razorpay TEST. It is the manual half of the phase's acceptance criteria, and it is short on purpose.

---

## 1. Purpose, scope and safety

- **TEST only.** Use the TEST keys and `BILLING_EXPECTED_MODE=test`. Never point this runbook at LIVE.
- **The dev database, never the integration database.** The app uses `DATABASE_URL`. `DATABASE_TEST_URL` belongs to the automated suites.
- **Billing tables are audit records.** Never delete `billing_operation`, `subscription_history_entry`, `billing_event`, `billing_money_fact` or `billing_anomaly` rows to "reset" a scenario. Where a scenario needs an anomaly or an old event and none exists, it says so; use a labelled fixture row (an id or subject key containing `manual-p8`) and leave it.
- **Payloads are personal data.** Do not paste a raw payload into a ticket, chat or this document.
- **Bulk re-sync marks every matching subscription in the dev database.** In TEST that is a handful of rows; the marked rows are then fetched (read only) from Razorpay TEST.

## 2. Prerequisites

- The app running against the dev database (`pnpm dev`, or `pnpm build && pnpm start`), migrations applied (Phase VIII adds none).
- Four users, one per role: `SUPER_ADMIN`, `ADMIN`, `MODERATOR`, and an ordinary `USER`.
- A customer with a **TEST subscription** from the Phase V–VII runs (any phase), and ideally a webhook delivery for it (the Phase IV ngrok tunnel; see the [operations runbook](../../cross-cutting/operations-runbook.md#verifying-the-webhook-against-razorpay-test)).
- `CRON_SECRET` in `next/.env`, for the manual task routes.

## 3. Scenarios

| ID | Scenario | Do | Expect |
| --- | --- | --- | --- |
| **V1** | Role matrix in the UI | Open **Admin → Billing operations** as each of the four users | `SUPER_ADMIN` and `ADMIN`: the page loads. `MODERATOR` and `USER`: refused (they cannot reach the admin area). `ADMIN` sees no Bulk re-sync panel; `SUPER_ADMIN` does. The **Promotions** menu entry shows for `SUPER_ADMIN` only |
| **V2** | Health summary | As `ADMIN`, read the overview | Provider mode is `TEST`; the phase counts match what you know; the last run of `billing:sync` is recent after `GET /api/v1/internal/billing/sync` with `Authorization: Bearer <CRON_SECRET>`; "last webhook" moves after a Dashboard action that fires a webhook; cooldown reads clear |
| **V3** | Look up and explain | Look the customer up by e-mail, open their page | The effective plan and the winning source match what the customer sees in their own billing panel; each source says why it does or does not contribute; a grant shows its reason and granter |
| **V4** | Timeline | On the same page, read the timeline; filter to one subscription | History entries, operations and (after a webhook) events and money facts appear, newest first, in a believable order. An event shows its type, status, secret and provider event id, and **no payload** |
| **V5** | Sync now | As `ADMIN`, press **Sync now** on the customer's subscription | A toast names the outcome; the row's "last synced" moves; a Dashboard change made beforehand is picked up (`provider_observed`) |
| **V6** | ADMIN is read-only | As `ADMIN`, look for cancel, resolve, bulk re-sync and payload controls | None is offered. Calling `POST /api/v1/admin/billing/resync` and `…/anomalies/{id}/resolve` from the browser console answers `403` |
| **V7** | Raw payload | As `SUPER_ADMIN`, press **View** on a webhook event; then as `ADMIN` | `SUPER_ADMIN` sees the payload in a dialog; the server log has `admin.payload_viewed` with your id and the event id, and **not** the payload. `ADMIN` sees "Restricted" and `GET …/events/{id}/payload` answers `403` |
| **V8** | Bulk re-sync | As `SUPER_ADMIN`, enter a reason, press **Preview**, then confirm | The preview count is plausible; confirming marks that many due (`resync.bulk_marked` in the log); nothing reaches Razorpay until `billing:sync` runs (`GET /api/v1/internal/billing/sync`), after which the due backlog on the overview falls. Only fetches are made |
| **V9** | Anomaly | Open **Billing anomalies**; if none exists, insert one labelled `manual-p8` (an open row) | As `ADMIN` it lists and opens, without a Resolve button. As `SUPER_ADMIN`, **Resolve** demands a reason; afterwards it shows as resolved with your name and reason, and no subscription, operation or grant changed |
| **V10** | Immediate cancel from the UI | As `SUPER_ADMIN` on a disposable TEST subscription, **Cancel now…** with a reason | The subscription becomes `CANCELLED` (or "being confirmed" and then cancelled after a sync); the timeline shows the operation with your reason. This is the Phase VI command; only its home is new |
| **V11** | Payload prune | `GET /api/v1/internal/billing/payload-prune` without, then with, the secret | Without: `401`. With: `200` and `{ pruned, batches, stoppedBy, cutoff }`. In a fresh dev database `pruned` is 0. Recent payloads stay viewable |
| **V12** | Alert link | Trigger any anomaly alert (V9's fixture does not alert; use a real detection if one occurs) or read an existing `billing.alert` log line | It carries an `adminPath` that opens the anomaly or user page |

## 4. What this runbook cannot show

- **A pruned payload in the UI.** A dev database has no payload older than 180 days. The automated suite proves the pruning rule; a labelled fixture event with an old `receivedAt` may be used to see the "Pruned" state.
- **LIVE behavior.** Nothing here is LIVE.
- **Alert delivery.** There is no channel until Phase IX.

## 5. Current verification status

Append a row per scenario when it is run: date (UTC), commit, who, result **as observed**.

| Scenario | Status | Date | Notes |
| --- | --- | --- | --- |
| V1–V12 | UNVERIFIED | — | Not yet run against the real UI. The API contract behind each is covered by the automated suites |
