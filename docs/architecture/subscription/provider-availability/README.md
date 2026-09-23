# Provider Availability

> **Status:** Design — not implemented
>
> **Last Updated:** 2026-09-24

Test, live, and disabled as three first-class provider states — never an emergent property of
missing environment variables.

| Document | Contents |
| --- | --- |
| [`environments.md`](environments.md) | How provider mode is resolved, the expected billing mode, mode stamping, TEST vs LIVE safety |
| [`disabled-provider-mode.md`](disabled-provider-mode.md) | What "paid billing unavailable" means concretely |
| [`outage-and-stale-state.md`](outage-and-stale-state.md) | A temporary Razorpay outage must never revoke access |

## The scenarios this covers

| Scenario | Provider mode |
| --- | --- |
| Local development, no Razorpay credentials | `disabled` |
| Development with Razorpay TEST credentials | `test` |
| Production with live credentials | `live` |
| Production deployed **before** live credentials exist | `disabled` — a fully supported state, see [SB-PB-03](../../../project/feature-specification/subscription/decisions/provider-boundary-and-environments.md#sb-pb-03--disabled-is-a-fully-supported-production-state) |
| Production, Razorpay temporarily unreachable | mode stays `live`; see [`outage-and-stale-state.md`](outage-and-stale-state.md) — this is not a mode change, it's a runtime condition |
