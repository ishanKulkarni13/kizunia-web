# Operations Runbook

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24 (decision close-out: IB-14, IB-19)

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

## Admin tools this runbook assumes

| Tool | Does |
| --- | --- |
| Sync now (one user or Subscription) | Marks sync-due with priority 1 and runs it; shows the result |
| Explain effective access | [`observability.md`](observability.md#effective-access-explanation) |
| Billing timeline | History entries, operations, events and money facts for a user, in one view |
| Immediate cancel | Recorded command, reason required |
| Resolve anomaly | Marks an anomaly resolved with actor and reason; never changes billing state itself |
| Bulk re-sync | Marks every non-terminal Subscription (optionally filtered) due now; drains within the budget |

## Webhook endpoint disabled or failing

**Signal:** `WEBHOOK_SILENCE`, webhook 5xx or latency alerts, or Razorpay's "webhook disabled" email.

1. Fix the cause (deploy, database, secret mismatch — check which secret signatures fail against).
2. Re-enable the webhook in the Razorpay Dashboard (per mode).
3. Run a bulk re-sync limited to Subscriptions whose `lastSyncedAt` predates the incident start.
   Checkpoints would catch up eventually; the bulk re-sync makes it prompt.
4. If the outage exceeded 24 hours, events in that period were never delivered; the re-sync covers
   state. For events under 15 days old Razorpay Support can replay them — optional, since replay only
   triggers syncs that the re-sync already did.

Never: mark events processed by hand; apply payload states manually.

## Razorpay outage

**Signal:** `UNAVAILABLE`/`TIMEOUT` rates, global cooldown active, users seeing "billing temporarily
unavailable".

1. Do nothing to local state. Access is unaffected by design ([`../provider-availability/outage-and-stale-state.md`](../provider-availability/outage-and-stale-state.md)).
2. Watch recovery: cooldown decays, the due backlog drains, `OUTCOME_UNKNOWN` operations resolve.
3. After recovery, review `OUTCOME_UNKNOWN` operations older than the alert threshold and
   `SYNC_OVERDUE` Subscriptions; use sync now on any that remain.

Never: extend or force access with grants "to be safe" (it hides real cancellations); retry
creates by hand.

## Rate limiting (429)

**Signal:** any `RATE_LIMITED`, sustained `BUDGET_EXHAUSTED`.

1. Confirm the budget configuration is below the limit Razorpay confirmed for the account
   ([A12](../../../project/feature-specification/subscription/open-decisions.md#a-razorpay-behavior-requiring-test-mode-verification-or-support)).
2. If a bulk operation (Dashboard bulk action, bulk re-sync) caused it, let it drain; the budget
   bounds it.
3. Lower the background share or ask Razorpay Support to raise the limit.

## Multiple open subscriptions

**Signal:** `MULTIPLE_OPEN_SUBSCRIPTIONS`.

1. Open the user's billing timeline; identify how the second subscription arose (history `cause`,
   `BillingOperation`s, `notes`).
2. With the user where appropriate, decide which subscription to keep.
3. Cancel the other through Kizunia's immediate-cancel command (recorded). Refund in the Razorpay
   Dashboard if the user was charged twice.
4. Resolve the anomaly with the reason. The user's self-serve billing actions unblock automatically.

## Unmatched provider subscription

**Signal:** `UNMATCHED_PROVIDER_SUBSCRIPTION`.

1. Inspect it in the Razorpay Dashboard: creator, customer, `notes`, payments.
2. If it was created outside Kizunia by mistake, cancel it in the Dashboard (and refund if charged).
3. If it carries Kizunia `notes` for a record that was already declared `ABANDONED`, that is a
   window-sizing bug: cancel/refund as appropriate and open an engineering issue; do not re-bind by
   hand.
4. Resolve the anomaly with the reason. V1 never attaches such a subscription to a user.

## Operation stuck in `OUTCOME_UNKNOWN`

**Signal:** `OPERATION_OUTCOME_UNKNOWN`.

- Create: check orphan-discovery progress (watermark) and search the Razorpay Dashboard for the
  `kz_sub` note. It resolves automatically when found or when the window closes.
- Update/cancel: run sync now on the Subscription; the operation resolves from what Razorpay shows.

## Unmapped plan or mode mismatch

**Signal:** `UNMAPPED_PROVIDER_PLAN`, `PROVIDER_MODE_MISMATCH`.

- Unmapped plan: add the Razorpay plan ID to the per-mode catalog (config change, deploy); the
  Subscription applies on its next retry. Never map it to a guessed tier to "unblock" it.
- Mode mismatch: find how a row of the other mode got here (restored database, wrong keys). Such rows
  never grant access; remove them only through a reviewed data migration.

## Rotating the webhook secret

1. Generate the new secret in the Dashboard; configure Kizunia with the **new** secret as current and
   the **old** secret as previous; deploy.
2. Save the new secret in the Dashboard.
3. Wait at least 24 hours (Razorpay's retry window) and until `BillingEvent`s no longer match the
   previous secret.
4. Remove the previous secret; deploy.

Never switch the secret without the previous-secret window — retries of earlier events would fail
signature checks until Razorpay disables the webhook ([SB-WH-07](../../../project/feature-specification/subscription/decisions/webhooks-and-reliability.md#sb-wh-07--the-previous-webhook-secret-is-accepted-during-a-rotation-window)).

## Rotating API keys

1. Generate new keys in the Dashboard (same mode); configure and deploy. Mode resolution at boot
   validates the pair.
2. Revoke the old keys after the deployment is live. An `AUTH_FAILURE` page after this step means an
   instance still has old keys.

Checkout signatures are computed with the key secret: a checkout started under the old key and
confirmed after the switch fails signature verification. That is harmless — confirmation only
triggers a sync, and the webhook/sync path still grants access.

## Deployment during billing activity

Nothing special is required: webhook handling is one short transaction; syncs and commands are
leased or recorded before their external call. A deployment that kills an in-flight command leaves an
`IN_FLIGHT` operation that expires into `OUTCOME_UNKNOWN` and resolves by observation. Avoid
deploying a change to the plan catalog or state mapping in the middle of a bulk re-sync.

## Database restore or corrupted local state

1. Restore; the restored state is simply stale.
2. Run a bulk re-sync of all non-terminal Subscriptions and let orphan discovery re-scan from a
   watermark before the restore point. Webhooks received after the restore point are gone from the
   database, but their effects are recovered by the re-sync.
3. `BillingOperation`s issued after the restore point are lost; the provider subscriptions they
   created are found by orphan discovery via `notes`, and bind only if their `PROVISIONING` record
   also survived — otherwise they surface as `NOTES_CONFLICT`/unmatched for manual handling.

## Queue or tick failure

**Signal:** due backlog age growing; internal task marker shows `billing-sync` not running.

Check the scheduler (Vercel Cron or the external scheduler) and the tick's own summary. On the
Vercel Hobby plan the only cron entry runs **daily**. Reaching the target cadence needs the external
pinger chosen before LIVE ([IB-19](../implementation/open-decisions.md#ib-19--tick-cadence-on-the-vercel-hobby-plan)),
so a backlog up to a day old is expected without it. Immediate
paths (`after()`, checkout confirmation) keep working meanwhile; only retries, checkpoints and orphan
discovery wait. Invoking the tick endpoint manually with the cron secret is always safe.

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
