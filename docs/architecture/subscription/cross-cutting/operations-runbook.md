# Operations Runbook

> **Status:** Implemented — every procedure below maps to a tool that exists (Phases IV–VIII)
>
> **Last Updated:** 2026-09-26 (Phase VIII: admin tools built, runbook aligned with them; [IB-28](../implementation/open-decisions.md#ib-28--phase-viii-decisions-and-implementation-rulings))

What operators and on-call engineers do when billing needs a human. Each procedure states the signal,
the safe first action, and what must never be done. The design principle behind all of them: **fix by
observing Razorpay again, not by editing local state by hand.**

---

## Ground rules for operators

- Prefer Kizunia's admin commands (sync now, immediate cancel) over Razorpay Dashboard actions: they
  are recorded as `BillingOperation`s with the operator as actor.
- Use the Razorpay Dashboard for what Kizunia does not do: refunds, and inspecting Razorpay's own
  records. Dashboard changes are picked up automatically, attributed as `provider_observed`.
- Never create a subscription in the Dashboard to give someone access — use an admin grant.
- Never edit `Subscription` phase, plan or provider ID directly in the database. If local state looks
  wrong, run "sync now"; if it is still wrong, the provider state or the mapping is what needs
  fixing.
- **Nothing here pages anyone yet.** Alerts are structured `billing.alert` log events; the channel that
  delivers them is a Phase IX item ([IB-11](../implementation/open-decisions.md#ib-11--alerting-channel)).
  Until then, watching the billing health page is the manual substitute. Each alert carries an
  `adminPath` that names the admin page to open.

## Admin tools

All under **Admin → Billing operations** (`/admin/billing`) and `/api/v1/admin/billing/…`. Roles are
the owner's ruling ([IB-15](../implementation/open-decisions.md#ib-15--billing-admin-roles)): `ADMIN` can
diagnose and sync; `SUPER_ADMIN` can also change things. `MODERATOR` and `USER` have none. The platform
admin bypass never confers a billing action.

| Tool | Where | Route | Roles | Does |
| --- | --- | --- | --- | --- |
| **Health summary** | Billing operations | `GET /admin/billing/health` | `ADMIN`, `SUPER_ADMIN` | Subscriptions by phase; due backlog and its oldest age; the oldest due subscriptions; open anomalies by type; `OUTCOME_UNKNOWN` count, oldest age and the oldest few; the last run of `billing:sync`, `billing:orphan-discovery` and `billing:payload-prune`; cooldown and auth-pin state; the orphan-scan watermark; the last webhook per mode and the last one verified by the previous secret; the provider mode |
| **User lookup** | Billing operations | `GET /admin/billing/users?email=` or `?userId=` | `ADMIN`, `SUPER_ADMIN` | Finds a user, then opens their billing page |
| **Explain access** | A user's billing page | `GET /admin/billing/users/{id}/access` | `ADMIN`, `SUPER_ADMIN` | The resolver's own explanation: every source (subscriptions, grants, the free default), whether it contributes and why not (phase, mode mismatch, grant expired or revoked), the resulting plan and the winning source, plus each subscription's phase, sync state and each grant's reason and granter. Current instant only |
| **Billing timeline** | A user's billing page (filterable to one subscription) | `GET /admin/billing/users/{id}/timeline`, `GET /admin/billing/subscriptions/{id}/timeline` | `ADMIN`, `SUPER_ADMIN` | History entries, operations, webhook events (metadata) and money facts, newest first. Never a raw payload |
| **Raw payload** | Timeline → View | `GET /admin/billing/events/{id}/payload` | `SUPER_ADMIN` only | One webhook's raw payload while it is retained. May contain customer contact details; the view is logged with your name, never the content |
| **Anomalies** | Billing anomalies | `GET /admin/billing/anomalies`, `GET /admin/billing/anomalies/{id}` | `ADMIN`, `SUPER_ADMIN` | List (open first; filter by status, type, user) and inspect |
| **Resolve anomaly** | An anomaly's page | `POST /admin/billing/anomalies/{id}/resolve` | `SUPER_ADMIN` only | Records a decision with a reason. **Never changes billing state**: fix the situation first, then resolve. If it is still true it is detected again as a new anomaly |
| **Sync now** (one Subscription) | A user's billing page | `POST /admin/billing/subscriptions/{id}/sync` | `ADMIN`, `SUPER_ADMIN` | Fetches that Subscription from Razorpay at priority 1 and applies it; shows the outcome |
| **Bulk re-sync** | Billing operations | `POST /admin/billing/resync` | `SUPER_ADMIN` only | Marks every bound, non-terminal Subscription of the provider mode due (optionally only those last synced before a time), with a reason. **It only marks rows**: `billing:sync` fetches them at priority 3 within the request budget, so a large re-sync drains over several runs. Preview first (a dry run counts, writes nothing) |
| **Immediate cancel** | A user's billing page | `POST /admin/billing/subscriptions/{id}/cancel` | `SUPER_ADMIN` only | A recorded command with a reason; takes the customer's operation slot. Does not resolve an anomaly |
| **Grants and promotions** | Entitlement grants, Promotions | `/admin/billing/grants`, `/admin/billing/promotions` | view: `ADMIN`, `SUPER_ADMIN`; change: `SUPER_ADMIN` | Free plan access with a reason and audit ([admin grants](../implementation/admin-grants.md)) |
| **Manual task runs** | — (a request with `Authorization: Bearer <CRON_SECRET>`) | `GET /internal/billing/sync`, `/internal/billing/orphan-discovery`, `/internal/billing/payload-prune`, `/internal/tick` | the cron secret | Run a task now, outside the tick. Always safe to repeat |
| **Webhook verification (TEST only)** | a terminal | `pnpm billing:webhook-verify` | an engineer | See [Verifying the webhook against Razorpay TEST](#verifying-the-webhook-against-razorpay-test) |

The tick (`/internal/tick`) runs `billing:sync` every time, then `billing:payload-prune` once a day and
`billing:orphan-discovery` last. On the Vercel Hobby plan it runs **daily**; see
[Queue or tick failure](#queue-or-tick-failure).

## Webhook endpoint disabled or failing

**Signal:** `WEBHOOK_SILENCE`, webhook 5xx or latency alerts, or Razorpay's "webhook disabled" email. The
health page shows the last webhook received per mode and how long ago.

1. Fix the cause (deploy, database, secret mismatch — check which secret signatures fail against).
2. Re-enable the webhook in the Razorpay Dashboard (per mode).
3. Run a **bulk re-sync** (`SUPER_ADMIN`) with "last synced before" set to the incident start. Preview
   the count, then confirm. Checkpoints would catch up eventually; the bulk re-sync makes it prompt. It
   only marks the Subscriptions due: they drain through `billing:sync` at priority 3, so watch the due
   backlog on the health page shrink, or run `GET /internal/billing/sync` to drain faster.
4. If the outage exceeded 24 hours, events in that period were never delivered; the re-sync covers
   state. For events under 15 days old Razorpay Support can replay them — optional, since replay only
   triggers syncs that the re-sync already did.

Never: mark events processed by hand; apply payload states manually.

## Razorpay outage

**Signal:** `UNAVAILABLE`/`TIMEOUT` rates, global cooldown active (the health page shows it), users
seeing "billing temporarily unavailable".

1. Do nothing to local state. Access is unaffected by design ([`../provider-availability/outage-and-stale-state.md`](../provider-availability/outage-and-stale-state.md)).
2. Watch recovery on the health page: the cooldown ends, the due backlog drains, `OUTCOME_UNKNOWN`
   operations resolve.
3. After recovery, review the oldest `OUTCOME_UNKNOWN` operations and the oldest due Subscriptions on
   the health page (each links to the user); use **sync now** on any that remain.

Never: extend or force access with grants "to be safe" (it hides real cancellations); retry
creates by hand.

## Rate limiting (429)

**Signal:** any `RATE_LIMITED`, sustained `BUDGET_EXHAUSTED`; the health page shows the cooldown.

1. Confirm the budget configuration is below the limit Razorpay confirmed for the account
   ([A12](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)).
2. If a bulk operation (Dashboard bulk action, bulk re-sync) caused it, let it drain; the budget
   bounds it.
3. Lower the background share or ask Razorpay Support to raise the limit (configuration and a support
   request: not an admin tool).

## Multiple open subscriptions

**Signal:** `MULTIPLE_OPEN_SUBSCRIPTIONS`. The alert links to the anomaly; the anomaly links to the user.

1. Open the user's billing page and its timeline; identify how the second subscription arose (history
   `cause`, operations, notes).
2. With the user where appropriate, decide which subscription to keep.
3. Cancel the other with **immediate cancel** (`SUPER_ADMIN`, recorded, with a reason). Refund in the
   Razorpay Dashboard if the user was charged twice.
4. **Resolve the anomaly** with the reason (`SUPER_ADMIN`). Cancelling does not resolve it. The user's
   self-serve billing actions unblock once it is resolved.

## Unmatched provider subscription

**Signal:** `UNMATCHED_PROVIDER_SUBSCRIPTION`.

1. Inspect it in the Razorpay Dashboard: creator, customer, `notes`, payments. The anomaly's detail
   shows the provider subscription id to search for.
2. If it was created outside Kizunia by mistake, cancel it in the Dashboard (and refund if charged).
3. If it carries Kizunia `notes` for a record that was already declared `ABANDONED`, that is a
   window-sizing bug: cancel/refund as appropriate and open an engineering issue; do not re-bind by
   hand.
4. **Resolve the anomaly** with the reason (`SUPER_ADMIN`). V1 never attaches such a subscription to a
   user.

## Operation stuck in `OUTCOME_UNKNOWN`

**Signal:** `OPERATION_OUTCOME_UNKNOWN`. The health page lists the oldest such operations with their user.

- Create: the health page shows the orphan scan's watermark and when `billing:orphan-discovery` last ran.
  If it is behind, run it now with `GET /internal/billing/orphan-discovery`. Search the Razorpay
  Dashboard for the `kz_sub` note. It resolves automatically when found or when the window closes.
- Update/cancel: run **sync now** on the Subscription from the user's page; the operation resolves from
  what Razorpay shows.

## Unmapped plan or mode mismatch

**Signal:** `UNMAPPED_PROVIDER_PLAN`, `PROVIDER_MODE_MISMATCH`. List them with the anomalies tool
(filter by type); the detail names the subject.

- Unmapped plan: add the Razorpay plan ID to the per-mode catalog (config change, deploy); the
  Subscription applies on its next retry, and the anomaly resolves itself when it does. Never map it to
  a guessed tier to "unblock" it.
- Mode mismatch: find how a row of the other mode got here (restored database, wrong keys); the user's
  explain view shows it as `MODE_MISMATCH`, not contributing. Such rows never grant access; remove them
  only through a reviewed data migration. **This is the one procedure that is deliberately not a tool**:
  it is an engineering change, never an operator action.

## Provider subscription missing

**Signal:** `PROVIDER_SUBSCRIPTION_MISSING` (subject `psub:<provider id>`).

A sync fetch of a provider subscription ID Kizunia stored was refused as unknown (a `400`, or a `404` for a malformed ID; [IB-23](../implementation/open-decisions.md#ib-23--detecting-a-missing-provider-subscription)). Kizunia changed nothing: the subscription keeps its phase and access, and is retried at the capped backoff. The anomaly resolves itself on the next successful fetch.

- Check the ID in the Razorpay Dashboard of the **same mode**. Found there: the refusal was transient; run "sync now" and the anomaly resolves.
- Not found: the row was bound to an ID from another account or mode (a restored database, swapped keys). Treat it like a mode mismatch (above); never edit the phase by hand.

## Verifying the webhook against Razorpay TEST

`pnpm billing:webhook-verify` (TEST only) seeds a subscription on a TEST catalog plan, cancels it at Razorpay, runs one `billing:sync`, and prints what Kizunia recorded (`status <id>`). With the dev server behind the registered tunnel, a cancel reaches Kizunia as `subscription.cancelled`; with the server stopped, the delivery fails and `tick` observes the change by heartbeat instead. The ngrok inspector (`http://127.0.0.1:4040`) shows every delivery attempt and its `x-razorpay-event-id`, and can replay one (it must come back a duplicate). The result also shows in the user's timeline as a webhook event. Deactivate the TEST webhook in the Dashboard when not verifying: Razorpay disables it after 24 hours of failed deliveries.

## Rotating the webhook secret

1. Generate the new secret in the Dashboard; configure Kizunia with the **new** secret as current and
   the **old** secret as previous; deploy.
2. Save the new secret in the Dashboard.
3. Wait at least 24 hours (Razorpay's retry window) **and** until the health page's "last
   previous-secret match" for that mode is older than that (or "never"): no event is still arriving
   signed with the old secret.
4. Remove the previous secret; deploy.

Never switch the secret without the previous-secret window — retries of earlier events would fail
signature checks until Razorpay disables the webhook ([SB-WH-07](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-07--the-previous-webhook-secret-is-accepted-during-a-rotation-window)).

## Rotating API keys

1. Generate new keys in the Dashboard (same mode); configure and deploy. Mode resolution at boot
   validates the pair.
2. Revoke the old keys after the deployment is live. An `AUTH_FAILURE` page after this step means an
   instance still has old keys. The health page shows the auth pin; it lifts itself once the
   configured key changes.

Checkout signatures are computed with the key secret: a checkout started under the old key and
confirmed after the switch fails signature verification. That is harmless — confirmation only
triggers a sync, and the webhook/sync path still grants access.

## Deployment during billing activity

Nothing special is required: webhook handling is one short transaction; syncs and commands are
leased or recorded before their external call. A deployment that kills an in-flight command leaves an
`IN_FLIGHT` operation that expires into `OUTCOME_UNKNOWN` and resolves by observation. Avoid
deploying a change to the plan catalog or state mapping in the middle of a bulk re-sync (watch the
due backlog on the health page).

## Database restore or corrupted local state

1. Restore; the restored state is simply stale.
2. Run a **bulk re-sync** (`SUPER_ADMIN`) of all non-terminal Subscriptions (no time filter). Orphan
   discovery needs no reset: the restored provider state already carries a watermark at or before the
   restore point, so it re-scans from there by itself (run `GET /internal/billing/orphan-discovery` to
   speed it up). Webhooks received after the restore point are gone from the database, but their effects
   are recovered by the re-sync.
3. `BillingOperation`s issued after the restore point are lost; the provider subscriptions they
   created are found by orphan discovery via `notes`, and bind only if their `PROVISIONING` record
   also survived — otherwise they surface as `NOTES_CONFLICT`/unmatched anomalies, handled as in
   [Unmatched provider subscription](#unmatched-provider-subscription).

## Queue or tick failure

**Signal:** due backlog age growing; the health page shows `billing:sync` not having run recently (its
last run, and whether it failed).

Check the scheduler (Vercel Cron or the external scheduler) and the health page's last run of each
billing task. On the Vercel Hobby plan the only cron entry runs **daily**. Reaching the target cadence
needs the external pinger chosen before LIVE ([IB-19](../implementation/open-decisions.md#ib-19--tick-cadence-on-the-vercel-hobby-plan)),
so a backlog up to a day old is expected without it. Immediate
paths (`after()`, checkout confirmation) keep working meanwhile; only retries, checkpoints and orphan
discovery wait. Invoking the tick endpoint, or `GET /internal/billing/sync`, manually with the cron
secret is always safe.

## Webhook payload retention

Raw webhook payloads may carry customer contact details, so `billing:payload-prune` nulls a payload
after 180 days (`BILLING_PAYLOAD_RETENTION_DAYS`, the B3 default) in bounded batches, once a day. The
event row, its money facts and history are never deleted. After that the raw payload is gone: the
timeline still shows the event (type, time, status, linkage), marked as pruned. If the task is behind,
the health page shows its last run; run `GET /internal/billing/payload-prune` to catch up. A
payload cannot be recovered afterwards; ask Razorpay Support for a replay only for events under 15 days old.

## Account removal for a paying user

**V1 status: the removal workflow is DEFERRED**
([IB-14](../implementation/open-decisions.md#ib-14--account-removal-storage)). Kizunia has no
account-deletion feature. Every billing and grant table references the user with `onDelete: Restrict`,
so Better Auth's admin `remove-user` **fails** (a foreign-key error) for any user who has billing or
grant rows. That is intended: it is the safe failure. Do not work around it with manual SQL. Record
the request and escalate until the workflow exists.

The intended workflow, for when it is built: the flow refuses while a Subscription is open. Cancel it
immediately (recorded command), wait for the sync to show `CANCELLED`, then remove the account;
billing records are pseudonymized
([SB-DP-04](../../../project/feature-specification/subscription/decisions/data-preservation.md#sb-dp-04--billing-records-survive-account-removal)).
Retention (B3) must be decided first.
