# Reconciliation

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-21

The safety net behind webhooks. No webhook system — including Razorpay's own, documented
at-least-once but not delivery-guaranteed-forever — can be assumed to be the only mechanism keeping
Kizunia's state correct. Reconciliation is what makes correctness independent of any single webhook
actually arriving and being processed.

| Document | Contents |
| --- | --- |
| [`reconciliation-job.md`](reconciliation-job.md) | The periodic job, the on-demand trigger, and what happens if Razorpay is unavailable during a pass |

## What is authoritative

Razorpay is always authoritative for billing facts. Reconciliation never "corrects" Razorpay based
on Kizunia's local state — it only ever pulls Razorpay's state into Kizunia and corrects local drift
to match it.
