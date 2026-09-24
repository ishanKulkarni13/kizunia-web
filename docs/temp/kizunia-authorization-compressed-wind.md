# Kizunia Authorization & Access-Control Architecture Audit

> **STALE (marked 2026-09-24).** This audit predates `c956336` (2026-09-20), which completed its P1
> items: the `PortfolioPolicy` refactor onto `AuthorizationEvaluator` and the admin-route guard.
> Kizunia's current authorization architecture is described in `docs/architecture/authorization/`,
> and subscription integration decisions are in
> `docs/architecture/subscription/implementation/open-decisions.md` (IB-17). Kept for history; do
> not rely on its line references.

**Type:** Read-only audit deliverable (no code changes). This file *is* the requested report.
**Scope:** Authentication, authorization, ownership/membership, notifications, recommendations, MCP, API, admin, rate limiting, background jobs — evaluated for readiness to support a future Subscription/Entitlement system (Free/Pro/Pro+).
**Method:** Three parallel codebase investigations (auth/authz/projects/portfolio/admin; MCP/API/rate-limiting; notifications/recommendations/background jobs), each citing concrete file:line evidence from `d:\projects\kizunia-web`.

---

## 1. Executive Summary

Kizunia already has a **real, mostly-centralized authorization architecture** — not folder-name theater. A generic `AuthorizationEvaluator` chain (`next/src/authorization/evaluator.ts`) underlies a platform-wide policy (`PlatformPolicy`/`PlatformPermissionSet`) plus per-module policies (Projects, Competitions, MCP, Notifications) that all follow the identical `{context, context-resolver, permission-set, policy, authorizer}` shape. Ownership is modeled correctly as a *membership row with role=OWNER*, distinct from generic membership, in both Projects (`ProjectMember.role: OWNER`) — the exact distinction the future subscription quota needs.

More importantly, **the codebase already contains a not-yet-wired entitlement seam**, apparently built in anticipation of this exact project:
- `next/src/lib/entitlements/index.ts` — `resolveEntitlements()` currently hardcodes `{tier: "default"}`, with a comment describing where a real `Plan` model plugs in.
- `next/src/lib/rate-limit/resolver.ts` — `resolvePolicy(policyId, subject, entitlements)` already receives an `entitlements` argument (currently ignored) that would let rate-limit tiers vary by plan without touching any call site.
- `next/src/authorization/platform/permission-set.ts:16-24` — the `CREATE_PORTFOLIO` baseline grant has an explicit comment flagging it as "the seam a future plan/entitlement system will restrict," and `AuthorizationCode.UPGRADE_REQUIRED` / `FEATURE_DISABLED` are already-reserved (currently unused) denial codes.

One module diverges from the convention: **Portfolio's authorization policy is hand-written** (a `switch` statement) rather than built on `AuthorizationEvaluator`, and duplicates the admin-bypass check inline instead of using `.platformOverride()`. This is a real inconsistency, but a small, isolated one — not evidence of fragmentation across the whole app.

Notifications and recommendations are cleanly layered (preference → eligibility query → generation → transactional-outbox → delivery) with **zero existing entitlement checks** — which is exactly the shape needed to insert one later, at one seam (the scheduler query + a shared `isEnabledForUser`-style gate), without restructuring the pipeline.

MCP does **not** have a parallel permission system — it reuses `PlatformPolicy`/`CompetitionPolicy` after an OAuth-scope gate, and this is enforced by the codebase's own design convention (a docstring explicitly forbidding MCP-specific authorization helpers from being added). It also already has MCP-specific rate-limit policies wired to the same soon-to-be-entitlement-aware resolver.

**Overall verdict: READY WITH CHANGES.** No P0 security blockers were found that make subscription work unsafe to build on top of. The main pre-work is: (a) align Portfolio's policy with the standard evaluator pattern so it doesn't drift further, (b) add a "no admin bypass" verification pass since admin pages self-check rather than being gated by a shared route guard, (c) decide the Free-plan representation model, and (d) build the actual `Plan`/`Entitlement` resolution behind the already-stubbed seams. Details and P0/P1/P2 breakdown below.

---

## 2. Authentication Architecture

**Provider:** Better Auth, configured in `next/src/lib/auth.ts:12-110` — `betterAuth(...)` with Prisma adapter, Google/GitHub social providers, native `emailAndPassword`, and plugins: `dash()` (infra dashboard auth), `admin()`, `mcp({ resource: mcpResourceUrl(), scopes: [...MCP_SCOPES] })` (OAuth 2.1/OIDC provider for MCP), `username(...)`, `nextCookies()`.

**Canonical "current user" access — `SessionService`** (`next/src/lib/auth/session.ts`), the single entry point every controller/page uses:
- `getActor(request?)` — throws 401 `AuthenticationError` if no session; nullable `id/role/banned` fields.
- `getStrictActor(request?)` — same, but asserts `id`, `role`, `banned !== undefined` are present, returning `StrictAuthorizationActor`. Used wherever writes happen.
- `getOptionalActor(request?)` — returns `null` instead of throwing, for public/optional-auth reads (e.g. `ProjectController.findMany`).

All three wrap `auth.api.getSession({ headers })`. No controller was found calling `auth.api.getSession` directly outside this file (aside from `auth.ts` itself and MCP code, below) — this is a genuinely canonical, un-bypassed choke point for session-based auth.

**Multiple authentication mechanisms exist, by design, for different transports:**
1. **Session cookie (Better Auth)** — default for all `/app/api/**` route handlers and Server Components, via `SessionService`.
2. **MCP OAuth 2.1 bearer tokens** — `next/src/modules/mcp/auth/authentication.ts:140-154`. `authenticateMcpToken` validates the token, requires a bound `userId`, and calls `assertTokenAudience()` (RFC 8707 resource-indicator check, preventing token replay against Kizunia's MCP server if minted for a different resource). This is authentication-only — no role/permission data is derived here.
3. **Internal cron/service shared secrets** — `x-internal-secret` header (`internal/competitions/lifecycle/route.ts:36-51`, plain `!==` comparison — flagged as a finding below) and `Authorization: Bearer <CRON_SECRET>` (`internal/tick/route.ts:102-115`, using `secretEquals`, a constant-time comparison). These are infrastructure secrets, not user-scoped credentials, and grant no per-user authority.

**No API keys exist.** Grep across `next/src` for `apikey|api-key|ApiKey` returns no user-facing API-key issuance/validation. The rate-limit subject-kind union reserves `"api_key"` and `"service_account"` variants (`lib/rate-limit/subject.ts:10-14`) that are typed but never constructed — a forward-looking seam, not a live feature.

**No global `middleware.ts`** exists in the repo — there is no centralized auth gate at the edge. Every route/page individually calls `SessionService`. This matters for the admin-page finding in §12.

**MCP authentication → identity resolution (two-stage, both real):**
1. `authenticateMcpToken` → `McpPrincipal { userId, clientId, grantedScopes }`.
2. `McpActorResolver.resolve` (`modules/mcp/auth/actor-resolver.ts:36-77`) calls `PlatformContextResolver.resolve({id: principal.userId, ...})` — **re-reading role/banned from Postgres on every MCP call**, rather than trusting anything embedded in the token. This is the same resolver session-based requests use.

**Background jobs / cron do not authenticate as a fabricated user.** Job handlers call ID-scoped service methods (e.g. `NotificationPreferenceService.isEnabledForUser(userId, intent)`) that bypass the actor-based authorization layer *by design* — the codebase's own comment states that "inventing a synthetic actor to satisfy `getForUser` would push a fake through the authorization layer." See §14 for the full implication.

**Answering the audit's authentication questions directly:**
1. Canonical way to get current user: `SessionService.{getActor, getStrictActor, getOptionalActor}`.
2. Multiple mechanisms: yes — session cookie, MCP OAuth bearer, internal shared secrets — each scoped to a different transport, not overlapping/competing.
3. Bypass of canonical mechanism: not found for user-facing code; internal cron/lifecycle routes intentionally use a separate secret-based mechanism (appropriate, since there is no "user" to authenticate for a cron trigation).
4. MCP authentication: OAuth 2.1 bearer token issued by Kizunia's own Better Auth instance acting as an OAuth authorization server.
5. API routes: session cookie via `SessionService`.
6. Background jobs: no actor — identity is `userId` taken from the job payload (itself derived from a scheduler query), no session, no fabricated actor.
7. Trusted/internal callers bypassing auth: yes, cron/lifecycle routes via shared secret — appropriate for their purpose, not a bypass of user authorization.

---

## 3. Authorization Architecture

**Central generic engine:** `next/src/authorization/evaluator.ts` — `AuthorizationEvaluator<TContext, TAction, TRole>`, a chainable builder:
- `.start(context)`
- `.platformOverride()` — short-circuits to allow if `PlatformAccess.canBypassAuthorization(actor)` (ADMIN/SUPER_ADMIN)
- `.security(predicate, code, message)` — e.g. ban checks
- `.permission(permissionSet, role, action)` — flat RBAC lookup, **fails closed** on unknown role
- `.require(predicate, code, message)`
- `.grant()` / terminal `.evaluate()` / `.allow()`

Returns an `AuthorizationDecision { allowed, code?, message? }` — never throws itself. `Authorization.assert(decision)` (`authorization/assert.ts`) is the point where a decision becomes a thrown `ForbiddenError`.

**One genuinely global policy:** `PlatformPolicy.can(context: PlatformContext, action: PlatformAction)` (`authorization/platform/policy.ts`), backed by `PlatformPermissionSet` (role → `Set<PlatformAction>`, `permission-set.ts`) and `PlatformAuthorizer.can()` (calls `Authorization.assert`). `PlatformContextResolver.resolve(actor)` re-reads `{id, role, banned}` from Prisma.

**Per-module policies that build on the same primitives** (each has its own `authorization/{actions,context,context-resolver,permission-set,policy,authorizer}.ts`, following an identical shape): Projects, Competitions, Competition suggestions, Notifications, Technologies, Assets, MCP (scope-gate only, see §10).

**The one architectural inconsistency: Portfolio.** `modules/portfolio/backend/authorization/policy.ts` does **not** use `AuthorizationEvaluator`. `PortfolioPolicy.can` is a hand-written `switch` returning plain object literals, with:
- An inline admin-bypass check duplicating `platformOverride()` (`role === ADMIN || role === SUPER_ADMIN`, lines 18-25) instead of reusing the shared helper.
- Owner-only checks computed by the *caller* as a plain boolean (`portfolio.userId === actor.id`, e.g. `PortfolioService.findMine:78`) rather than derived inside the policy from a resolved context, unlike Project's membership-row pattern.

This is drift from convention, not a security hole (the logic is still correct as far as investigated), but it means Portfolio is the one place a future engineer could accidentally miss a check that the shared evaluator would otherwise enforce structurally (e.g., forgetting a ban check).

**Call graph — who calls what:**
1. Controllers call `SessionService` for identity, never make authorization decisions themselves.
2. Services resolve a resource-specific `Context` (actor + resource + membership) via a `ContextResolver`, then call the module's `Authorizer.<action>(context)`, which runs the module `Policy.can(...)` through `AuthorizationEvaluator`, then `Authorization.assert(decision)`.
3. Repositories are purely data access — confirmed no permission logic in `ProjectRepository` or `CompetitionRepository` beyond data-scoping queries (e.g., "projects I'm a member of").

**Bypass mechanism:** `PlatformAccess.canBypassAuthorization(actor)` — `role === ADMIN || role === SUPER_ADMIN` — invoked via `.platformOverride()` in the evaluator chain. Used by Project, Competition, MCP-downstream policies. Portfolio duplicates it inline instead (see above) rather than bypassing it.

---

## 4. Actual Access-Control Flow

The real flow, confirmed by tracing an actual write (`PATCH /api/v1/projects/[id]`):

```
HTTP Route handler
  → Controller: SessionService.getStrictActor(request)   [AUTHENTICATION]
  → Controller: schema.parse(body)                         [INPUT VALIDATION]
  → Service: load resource + actor's membership row        [OWNERSHIP/MEMBERSHIP LOOKUP, real DB read]
  → Service: ContextResolver.fromData(...)                 [BUILD CONTEXT]
  → Service: Authorizer.<action>(context)
        → Policy.can(context, action) via AuthorizationEvaluator
              .platformOverride() → admin bypass check
              .security(...)      → ban check
              .permission(...)    → role-based RBAC lookup (membership.role)
        → Authorization.assert(decision)                   [THROW IF DENIED]
  → Repository: pure Prisma write, no authorization logic
```

This **matches the audit's hypothesized flow** (Authentication → Actor → Platform authorization → Resource authorization → Ownership/membership → Operation) for Projects, Competitions, and (with the caveat above) Portfolio. There is no separate "Feature/capability check" or "Rate limiting" stage baked into this chain today for ordinary writes — rate limiting is a parallel, independently-invoked concern (see §13), and there is no feature/entitlement stage at all yet (the gap the subscription work will fill).

---

## 5. Module-by-Module Access Matrix

| Module | Authentication | Authorization | Ownership | Membership | Feature Check | Rate Limit | Common Path |
|---|---|---|---|---|---|---|---|
| Projects | Session (`SessionService`) | `ProjectPolicy` via `AuthorizationEvaluator` | `ProjectMember.role=OWNER` | `ProjectMember` row (OWNER/MAINTAINER/CONTRIBUTOR) | None yet (`CREATE_PROJECT` is a baseline grant) | Not found on project CRUD specifically | Yes |
| Portfolio | Session | Hand-written `switch`, not `AuthorizationEvaluator`; inline admin check | `portfolio.userId === actor.id` (computed by caller) | N/A (1:1 `userId @unique`) | `CREATE_PORTFOLIO` baseline grant, explicitly flagged as future entitlement seam | Read-path policies exist in registry | Partial (drifted) |
| Competitions | Session (+ MCP OAuth for MCP path) | `CompetitionPolicy`/`CompetitionAuthorizer` via `AuthorizationEvaluator` | `CompetitionMember` row | `CompetitionMember` | `MANAGE_COMPETITION_LIFECYCLE` platform action for sensitive fields | Search/user-state policies in registry | Yes |
| Notifications (preferences) | Session | `PlatformPolicy.can` via `INTENT_REQUIRED_ACTION` map | N/A | N/A | Only role-based (`ADMIN_COMPETITION_SUGGESTION`); no plan gate | `NOTIFICATION_PREFERENCES_READ/WRITE` | Yes |
| Notification delivery (jobs) | None (job payload `userId`, no actor) | Bypassed by design (`isEnabledForUser`, ID-scoped, no `PlatformPolicy` call) | N/A | N/A | None | N/A | No (intentional) |
| Competition recommendations | Session (user route) / none (job) | Only via wrapping route/job, no recommendation-specific policy | N/A | N/A | None — open to all authenticated non-banned users | `RECOMMENDATIONS_GENERATE` | Partial |
| MCP | OAuth 2.1 bearer (own mechanism) | Scope gate (`requireScope`) then reuses `PlatformPolicy`/`CompetitionPolicy` | Same as REST (via `CompetitionContextResolver`) | Same as REST | None yet | `MCP_TOOLS_READ`/`MCP_TOOLS_WRITE`, both wired to the entitlement-ready resolver | Yes (after scope gate) |
| Admin pages | Session, self-checked per page | `PlatformAuthorizer.can(..., ACCESS_ADMIN_DASHBOARD / MANAGE_*)` | N/A | N/A | N/A | Not centrally enforced | Yes, but no shared route guard (see §12) |
| Internal/cron | Shared secret (`CRON_SECRET`, `INTERNAL_LIFECYCLE_SECRET`) | N/A (infra-level trust) | N/A | N/A | N/A | N/A | No (by design — different trust boundary) |
| Rate limiting | N/A (consumes already-resolved actor/subject) | N/A | N/A | N/A | Entitlement input already threaded through (`resolvePolicy`) but ignored today | Self | Central registry, call-site invoked |

---

## 6. Projects

**Creation trace:** `ProjectController.create` (`modules/projects/backend/controller.ts:196-239`) → `SessionService.getActor` → `CreateProjectSchema.parse` → `ProjectService.create` (`service.ts:274-344`):
1. Slug availability check.
2. Requires `actor.id`.
3. `PlatformAuthorizer.can({actor}, PlatformAction.CREATE_PROJECT)` — currently a baseline grant to every role (`permission-set.ts:15`).
4. Transaction: create `Project` (`status: DRAFT`, `visibility: PRIVATE`, `createdBy` = attribution only) + create `ProjectMember` row with `role: OWNER` — **this is where ownership is established, as a membership row, not a schema column.**

**Ownership vs. membership in the schema** (`prisma/schema.prisma`):
- `Project.createdById` (line 939) — attribution only (`onDelete: SetNull`), *not* an authorization concept.
- `ProjectMember` (line 979) — `{projectId, userId, role: ProjectRole}`, composite PK. `enum ProjectRole { OWNER, MAINTAINER, CONTRIBUTOR }` (line 1469). **Ownership = a `ProjectMember` row with `role = OWNER`.**

**Where a future project-quota check belongs:** `ProjectService.create`, right after the `PlatformAuthorizer.can(...)` call and before the `prisma.$transaction` (service.ts, around line 296-297). Requires a new repository method to count `ProjectMember` rows filtered to `role: OWNER` for the actor — the existing `countForMember`/`findManyForMember` methods (repository.ts:407-456) count *all* memberships regardless of role and would need a role filter, or a new `countOwnedByUser` method. This is a clean, single-point insertion — no architectural obstruction found.

---

## 7. Portfolio

**Lifecycle:** `PortfolioService.create` (`service.ts:88-161`) requires `actor.id`, calls `PlatformAuthorizer.can({actor}, PlatformAction.CREATE_PORTFOLIO)` (line 108 — already commented in the codebase as the plan/entitlement seam), resolves a create-context, calls `PortfolioAuthorizer.create`, enforces the `Portfolio.userId @unique` 1:1 constraint (one portfolio per user), then creates the row. `updateProfile` (line 166-253) loads by `userId`, builds context, calls `PortfolioAuthorizer.edit`. Public viewing goes through `findPublicByUsername` → `repository.findPublicByUsernameOrThrow`.

**Schema is thinner than Projects':** `Portfolio` (schema.prisma:1056) has only `visibility: PortfolioVisibility (PUBLIC|PRIVATE)` and `deletedAt` — **no `status`/`DRAFT`/`PUBLISHED` field at all**, unlike `Project`, which independently tracks `status` (DRAFT/PUBLISHED) and `visibility` (PUBLIC/UNLISTED/PRIVATE) as two axes. For Portfolio today: "exists" = row exists; "editable" = `isOwner` (inline boolean); "publicly visible" = `visibility === PUBLIC` only. **There is no distinct "published" concept for portfolios.**

This matters directly for the subscription spec's requirement (§12 of the product doc) that a downgraded user keep an editable-but-not-publicly-displayed portfolio — that requires either (a) reusing `visibility` as the gate and having the entitlement layer force it to `PRIVATE` on downgrade (destructive to the user's own visibility preference — not ideal), or (b) adding a genuinely separate "publicly displayable" concept independent of the user's own visibility setting. This is a real product/architecture gap to resolve during subscription design, not during this audit — but it must be flagged now because it is not a small implementation detail.

---

## 8. Notifications

**Preferences:** two schema tables — `NotificationPreference` (`userId, intent, enabled`, unique per pair) and `CompetitionPreference` (`userId, dimension, value, weight`, recommendation-input profile, not a toggle). Read/write via `NotificationPreferenceController` → `NotificationPreferenceService`. `update()` checks `applies()` (delegates to `PlatformPolicy.can` via an `INTENT_REQUIRED_ACTION` map) — only `ADMIN_COMPETITION_SUGGESTION` has a required action (role-based); the three user-facing intents (`TOP_RELEVANT_COMPETITION`, `REGISTRATION_CLOSING`, `FEATURE_ANNOUNCEMENT`) have **no gate today** — any authenticated user can toggle them regardless of any future plan. This already matches the product requirement that preferences must remain configurable independent of entitlement.

**Deadline notification lifecycle (full pipeline, confirmed by trace):**
```
Vercel cron (daily) → /api/v1/internal/tick (CRON_SECRET-gated)
  → runDueTasks → "notifications:tick" → NotificationTickService.run
    → NotificationSchedulerService.scheduleDueEvaluations
        → findEnabledUserIds: SELECT WHERE NotificationPreference.enabled=true AND user.banned≠true AND status=ACTIVE
        → enqueue one job per eligible user, keyed by occurrenceKey (dedup)
    → same tick's JobRunner.run drains the queue
        → evaluate-registration-closing.handler: re-checks isEnabledForUser (belt-and-suspenders)
        → NotificationGenerationService.generate (transactional outbox: Notification + NotificationDelivery(IN_APP, already DELIVERED) + enqueue DELIVER_NOTIFICATION job, one transaction)
        → deliver-notification.handler → DeliveryService.deliver: re-checks intentStillEnabled AGAIN immediately before push, then fans out FCM push per active subscription
```
**No entitlement check exists anywhere in this pipeline today** — confirmed no reference to `resolveEntitlements()` from any notification code path. The eligibility gate today is purely `NotificationPreference.enabled`, checked three times (scheduler query, handler, delivery) for defense-in-depth against races, not as separate authorization layers.

**Cleanest future insertion point:** the scheduler's `findEnabledUserIds` query (add an entitlement filter alongside the existing `enabled=true`/`banned`/`status` filters) **and** a parallel check inside the handler/delivery re-checks, mirroring the existing `isEnabledForUser`-style pattern exactly — i.e., a new `hasEntitlement(userId, capability)` function with the same ID-scoped, no-actor shape as `isEnabledForUser`, callable from a background job without fabricating a session actor.

---

## 9. Competition Recommendations

**Generation is eager/on-demand, not a standalone background job:** `POST /api/v1/me/recommendations/competitions` → `RecommendationController.generateForCurrentUser` → `SessionService.getStrictActor` → rate-limited (`RECOMMENDATIONS_GENERATE`) → `RecommendationService.generateForUser` — computed fresh per call, no persisted cache/table.

**Reused, not duplicated, across two callers:** the same `RecommendationService.generateForUser` engine is called both by the user-facing route above and by the notification job handlers (`NotificationPolicyService.evaluateTopRelevantCompetition`, `evaluate-registration-closing.handler`) to get relevance scores before deciding whether to notify. Generation, notification-decision (pure policy functions consuming the engine's output), and notification delivery are three cleanly separated layers connected only by explicit function calls — not shared mutable state.

**No gating today beyond the notification preference short-circuit inside job handlers.** The user-facing recommendation-generation route has **no gating at all** besides authentication, ban status, and rate limiting — any authenticated user can call it regardless of any future Pro+-only entitlement. This is the module most exposed to "wrong default" risk if the future entitlement gate is only added to the notification path and forgotten on the direct-generation route — worth flagging explicitly as a P1 item (see §22).

---

## 10. MCP

**Entry point:** `next/src/app/api/mcp/route.ts:25`, wrapped in Better Auth's `withMcpAuth(auth, handler)` → `dispatchMcpRequest` (`modules/mcp/server/transport/dispatch.ts`).

**Authentication:** OAuth 2.1, Kizunia's own Better Auth instance acting as the authorization server (`mcp()` plugin, `auth.ts:57-75`). Two-stage: `authenticateMcpToken` (token validity + audience check) → `McpActorResolver.resolve` (re-reads role/banned from Postgres via `PlatformContextResolver`, same resolver session-based requests use).

**Does MCP use the same authorization system as the rest of the app?** Yes. The only MCP-specific primitive is `requireScope()` (`modules/mcp/authorization/authorize-mcp.ts:45-52`), an OAuth-scope gate. Its own docstring explicitly forbids ever adding MCP-specific authorization helpers (e.g. a hypothetical `mcpCanCreateCompetition()`) — this is a documented architectural rule, not an accident. Everything downstream of the scope check reuses the identical `PlatformPolicy`/`CompetitionPolicy`/`AuthorizationEvaluator` chain the REST API uses. Traced end-to-end for `update_competition`: `requireScope` → `CompetitionContextResolver.resolveBySlug` (real DB membership lookup, IDOR-safe) → `CompetitionAuthorizer.edit` (same authorizer as REST) → an extra `PlatformAuthorizer.can(..., MANAGE_COMPETITION_LIFECYCLE)` for one sensitive field → `CompetitionService.update` (same domain service as REST).

**Scopes today:** `competitions:read` / `competitions:write` — narrowing-only, never elevating beyond what the resolved role/membership already permits. No plan-tier concept touches MCP scopes yet, but the design explicitly supports adding capability-scoped checks without a redesign (matching the product doc's "fine-grained MCP access" requirement).

**Resource-level (IDOR) authorization:** confirmed present — `CompetitionContextResolver.resolveBySlug` loads the real membership row before any decision; an MCP caller cannot act on a resource merely by guessing an identifier.

**MCP-specific rate limiting exists** (contradicts a stale doc comment claiming it's "remaining work" — `docs/architecture/mcp/README.md:278,326`): every `McpTool` must declare a `rateLimitPolicy` (compile-time enforced), dispatched via `enforceToolRateLimit` in `dispatch.ts:156-223`, using two dedicated policies (`MCP_TOOLS_READ` 60/min fail-open, `MCP_TOOLS_WRITE` 20/min fail-closed).

**Answering the audit's MCP questions:**
1. Same authorization system as the app? Yes, after the scope gate.
2. Separate permission system? Only the scope gate, deliberately kept minimal by design convention.
3. Bypass of normal authorization? No — resource-level checks are identical to REST.
4. Where would entitlement checks integrate? Most naturally as an additional `PlatformAction` check (or an entitlement branch inside `PlatformPolicy`) reused by both MCP and REST, or as a new required scope/tier gated by entitlement inside `requireScope`'s caller — not as a new MCP-specific concept, per the codebase's own stated rule.
5. Can it support multiple access levels later? Yes — the scope enum is already extensible, and rate-limit policies are already per-tool, both without redesign.

---

## 11. API Routes

**Pattern:** Controller (auth + validation) → Service (orchestration + authorization + ownership resolution) → Repository (pure data access, no authorization). Traced concretely for `PATCH /api/v1/projects/[id]` (see §4).

**Internal/service-to-service calls:** identity is established by shared secret, not by an actor — `x-internal-secret` header comparison (`internal/competitions/lifecycle/route.ts:36-51`, **plain `!==`, not constant-time** — flagged in §18) and `Authorization: Bearer <CRON_SECRET>` (`internal/tick/route.ts:102-115`, constant-time via `secretEquals`). These bypass user authorization entirely by design, since there is no user context for a cron trigger — the trust boundary is "possesses the infra secret," not "is an authorized user."

**Duplicated authorization?** No unintentional duplication found between route/service/repository layers — repositories hold no permission logic. The one place two authorization checks run for a single write (`update-competition.usecase.ts:56-61`: ordinary `EDIT` + an extra `MANAGE_COMPETITION_LIFECYCLE` check for one sensitive field) is deliberate layered authorization for a narrower sub-capability, not accidental drift.

---

## 12. Admin Authorization

**Role representation:** `User.role: String?` (Better Auth's raw field), mapped to `PlatformRole` enum (`USER`, `ADMIN`, `SUPER_ADMIN`, `MODERATOR`) in `authorization/platform/roles.ts`.

**Checks:**
1. `PlatformAccess.canBypassAuthorization(actor)` — `role === ADMIN || role === SUPER_ADMIN` — universal short-circuit via `.platformOverride()` in modules that use it (Projects, Competitions).
2. Fine-grained admin actions are ordinary `PlatformAction`s (`ACCESS_ADMIN_DASHBOARD`, `MANAGE_USERS` [SUPER_ADMIN only], `MANAGE_MEDIA`, `MANAGE_TECHNOLOGIES`, `MANAGE_NOTIFICATION_ANNOUNCEMENTS`, `MANAGE_COMPETITION_LIFECYCLE`, etc.), gated per-role in `PlatformPermissionSet`.

**Finding — no centralized admin-route guard.** `app/(dashboard)/admin/layout.tsx` performs no auth check; each admin page individually re-implements `SessionService.getActor()` + `PlatformAuthorizer.can(...)`. Confirmed on `admin/assets/page.tsx`, whose own comment notes "the API routes re-check `MANAGE_MEDIA` themselves" — i.e., the defense-in-depth is a *convention*, not a structural guarantee. A new admin page that forgets the check would render without server-side protection (client-rendered content might still be visible before any data-fetch failure surfaces, depending on the page's structure — not independently verified this session). This is the **primary security-relevant readiness gap** for admin-driven subscription features (e.g. an "Admin Grants Plan" page), and is addressed as P1 below.

**Admin ≠ Pro+, correctly separated today.** Admin access is a `PlatformRole`/`PlatformPermissionSet` concept entirely orthogonal to any future `Plan`/`Subscription` model — there is no code path today that conflates the two, and no `Plan` model exists yet to conflate with. This is a clean starting point for the product requirement that admins bypass paid gates without their "customer subscription" state being altered.

---

## 13. Rate Limiting

**Implementation:** custom, Postgres-backed fixed-window counters (`next/src/lib/rate-limit/`), no third-party library. `policies.ts` is the single source of truth (~20 policies incl. two MCP policies). `service.ts` (`RateLimitService.decide/check/enforce`) throws `RateLimitError` (429) on rejection. `resolver.ts`'s `resolvePolicy(policyId, subject, entitlements)` is **currently a pure passthrough** to the static registry — `entitlements` is received but ignored (`void subject; void entitlements;`), with a header comment explicitly documenting this as the future plan-override seam.

**Identity:** per-policy `subjectStrategies` (`ip`, `user`, `user-or-ip`, `global`, `credential`). Enforcement is call-site-driven (14 call sites across modules), not a blanket `middleware.ts`.

**Configurable per plan today?** No — `resolveEntitlements()` (`lib/entitlements/index.ts:32-34`) **always returns `{tier: "default"}`**, since no `Plan`/`Subscription` model exists yet. Both the entitlements resolver and the rate-limit resolver have comments explicitly stating that wiring a real `Plan` model requires only changing `resolveEntitlements()`'s body — zero changes needed at any of the 14 call sites, including both MCP policies.

**Admin bypass:** not found in the rate-limit system — an ADMIN is subject to the same per-user bucket as anyone else. (Admin bypass exists only in the authorization layer, orthogonal to rate limiting — consistent with the product requirement that "unlimited" quotas must not defeat abuse protection.)

**No API keys exist** — `"api_key"`/`"service_account"` subject kinds are typed but never constructed.

---

## 14. Background Jobs / Cron

**Single cron trigger:** Vercel cron → `/api/v1/internal/tick` (`CRON_SECRET`-gated, constant-time compare) → `runDueTasks` (`lib/internal-jobs/registry.ts`), a DB-marker-backed (`InternalJobRun`) idempotent dispatcher for three tasks: `notifications:tick`, `rate-limit:prune`, `assets:reconcile`.

**Queue:** hand-rolled Postgres-backed work queue (`notifications/jobs/postgres-work-queue.ts`), `JobRunner` draining leased jobs with backoff, handlers for: evaluate-top-relevant-competition, evaluate-registration-closing, deliver-notification, fanout-announcement, notify-admins-of-suggestion.

**Actor/system identity pattern — deliberate, not accidental.** Background jobs never fabricate a session actor. Services expose two parallel APIs: an actor-scoped one (`getForUser(actor)`, goes through `PlatformPolicy`) for controllers, and a **plain userId-scoped one with no authorization layer at all** (`isEnabledForUser(userId, intent)`) for jobs — explicitly documented as intentional, since "who is allowed to trigger this" was already answered by the scheduler/queue, not by an actor's permissions. There is no `SYSTEM_USER_ID` constant or service-role bypass; instead, privileged write operations (`NotificationGenerationService.generate`, `DeliveryService.deliver`) are called only from job handlers and never pass through `PlatformPolicy`/`SessionService`.

**Implication for entitlements:** because this bypass is structural (jobs don't route through the authorization layer at all), a future entitlement gate will **not** be caught "for free" by any shared authorization checkpoint inside the job pipeline — it must be added explicitly, at the scheduler query and/or inside each handler, mirroring the existing `isEnabledForUser` ID-scoped pattern. This is a correct architectural observation to carry into subscription design, not a bug to fix now.

---

## 15. Internal Service Authorization

Internal calls (cron → tick → task handlers; job handlers → generation/delivery services) operate on a **different trust boundary** than user-facing calls: possession of an infra secret (cron) or having been enqueued by the scheduler (jobs) substitutes for actor-based authorization. This is appropriate — there is no "user" performing these actions — but it does mean the two trust boundaries (secret-gated infra route vs. queue-derived job trust) are not interchangeable, and a future entitlement check must be placed explicitly inside the job/handler logic rather than assumed to be inherited from an upstream authorization pass.

---

## 16. Repository-Level Access Checks

Confirmed for `ProjectRepository` and `CompetitionRepository`: repositories perform *data-scoping* (e.g., "projects where I'm a member," membership lookups by `{projectId, userId}`) but hold **no permission/authorization decisions** — those live exclusively in the Policy/Authorizer layer above them. This is the correct separation and was consistent across every module traced; no findings of repositories silently gating access.

---

## 17. Public Access

- **Projects:** public/unlisted/private via `ProjectVisibility`, additionally gated by `ProjectStatus` (DRAFT/PUBLISHED) — two independent axes, checked together in `ProjectPolicy.canView`.
- **Portfolio:** public/private via `PortfolioVisibility` only — no independent publish-state axis (see §7). This is an intentional-looking simplification for the current single-tier product, but it is a genuine gap relative to the future requirement that a downgraded user's portfolio become non-public *without* touching their own visibility preference.
- **MCP:** the `mcp()` plugin exposes standard OAuth discovery endpoints (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`) — intentionally public, standard OAuth metadata, not a data-exposure concern.
- **Internal routes:** intentionally not public — secret-gated.

No evidence was found of unintentional public exposure of private data in the modules investigated this session.

---

## 18. Security Findings

| Severity | File | Symbol | Issue | Evidence | Impact | Recommendation |
|---|---|---|---|---|---|---|
| LOW | `next/src/app/api/v1/internal/competitions/lifecycle/route.ts:36-51` | secret comparison | Non-constant-time string comparison (`!==`) for `x-internal-secret`, vs. the constant-time `secretEquals` used in the sibling `tick` route | `internal/tick/route.ts:102-115` uses `secretEquals`; this route uses plain `!==` | Theoretical timing side-channel against an infra secret (low practical exploitability given network/latency noise, but inconsistent with the hardened sibling route) | Use the same `secretEquals` helper here for consistency |
| LOW/INFO | `app/(dashboard)/admin/layout.tsx` | (no guard) | No centralized admin-route auth guard; every admin page re-implements the check individually, by convention | Confirmed on `admin/assets/page.tsx`; layout itself performs no check | A future admin page (e.g. an "Admin Grant Plan" page for the subscription work) could be added without the check and rely only on the API route's own re-check for protection | Add a shared guard in the admin layout (or a wrapper util) that all admin pages get automatically, rather than relying on per-page discipline — especially before adding admin-grant UI |
| INFO | `modules/portfolio/backend/authorization/policy.ts` | `PortfolioPolicy.can` | Not built on `AuthorizationEvaluator`; duplicates admin-bypass inline instead of `.platformOverride()` | Hand-written `switch`, lines 18-25 duplicate `PlatformAccess.canBypassAuthorization` logic | Not a bypass today (duplication appears correct), but this is the one place a future maintainer could accidentally omit a check (e.g. ban check) that the shared evaluator enforces structurally elsewhere | Refactor onto `AuthorizationEvaluator` before/alongside subscription work, since Portfolio is one of the four modules the entitlement system must gate |
| INFO | Recommendation generation route | `RecommendationController.generateForCurrentUser` | No entitlement gate exists yet on the *direct* generation endpoint (only the notification-delivery path has a preference short-circuit) | Confirmed: route only checks auth, ban status, rate limit | Not a current vulnerability (recommendations are a free-to-generate compute feature today), but a real risk *after* subscription launch if the Pro+-only gate is added to the notification path and forgotten here | When implementing the entitlement, gate this route explicitly — do not assume the notification-path gate covers it |

No CRITICAL, HIGH, or MEDIUM findings were identified in the modules investigated. No IDOR was found in the traced flows (Projects, Competitions, MCP) — all use real DB-backed context resolvers before authorization decisions. No client-controlled role/permission/userId trust was found — `StrictAuthorizationActor` is always derived from a re-read of Postgres, never trusted from a request body.

**Not verified from the current codebase this session** (out of scope of the three research passes, should be checked before subscription implementation if not already covered elsewhere): Portfolio's public-read route full authorization trace beyond `findPublicByUsername`'s repository filter; the `dash()` plugin's own authentication semantics; full enumeration of every admin page individually re-implementing checks (only one page inspected as a representative sample); whether client-rendered admin page content could flash before a failed auth check completes.

---

## 19. Architectural Inconsistencies

1. **Portfolio's authorization policy is hand-written**, diverging from the `AuthorizationEvaluator` convention every other module follows (§3, §7, §18).
2. **No centralized admin-route guard** — admin pages are protected by convention, not structure (§12, §18).
3. **Portfolio's schema lacks an independent "published" axis**, unlike Projects (§7, §17) — a genuine product/architecture gap for the downgrade-behavior requirement, not merely a style inconsistency.
4. **Recommendation generation and recommendation-notification-eligibility are separate code paths today** (§9) — correctly separated for the current product, but the direct-generation route currently has no capability gate distinct from the notification path, which the subscription work must not assume is unified.

No hybrid "every module does its own independent authorization" pattern was found — the dominant pattern is genuinely centralized, with Portfolio as the single documented exception.

---

## 20. Entitlement Readiness

The codebase already anticipates this project in three concrete, currently-inert places:
- `lib/entitlements/index.ts::resolveEntitlements()` — stub returning `{tier: "default"}`.
- `lib/rate-limit/resolver.ts::resolvePolicy(policyId, subject, entitlements)` — receives but ignores `entitlements`.
- `authorization/platform/permission-set.ts:16-24` — `CREATE_PORTFOLIO` baseline grant flagged in-code as the future plan seam; `AuthorizationCode.UPGRADE_REQUIRED` / `FEATURE_DISABLED` already reserved and unused.

This means the **entitlement resolution layer can be built once** (a real `resolveEntitlements(actor) → Entitlements` implementation backed by a future `Plan`/`Subscription`/`Grant` model) and consumed from multiple existing seams — `PlatformPermissionSet`/`PlatformPolicy` for CREATE_PORTFOLIO-style gates, `resolvePolicy` for rate-limit tiers, and new ID-scoped checks in the notification scheduler/handlers and recommendation route — without restructuring any of the modules audited.

---

## 21. Subscription Readiness

**Ownership vs. membership** — correctly distinguished today (`ProjectMember.role = OWNER` vs. any other role); the project-quota requirement maps directly onto counting `role: OWNER` rows, with one new repository method needed.

**Non-destructive downgrade** — feasible without schema changes for Projects (existing rows + membership persist regardless of any future quota; only *creation* needs gating, which is a single call-site check). For Portfolio, feasible for "editable" and "exists," but the "publicly visible" requirement needs either reusing `visibility` (with the caveat noted in §7) or a new field — a real, if small, schema decision to make during entitlement design, not this audit.

**Preferences survive plan changes** — already true by construction: `NotificationPreference`/`CompetitionPreference` are independent of any plan concept and are never touched by the notification pipeline's preference-vs-delivery checks (only *delivery* is gated, never the stored preference).

**Admin independence from subscription** — already true; no code path conflates `PlatformRole` with any plan concept, because no plan concept exists yet to conflate it with.

---

## 22. Required Stabilization

### P0 — Must Fix Before Subscription
*None identified.* No security or architectural defect was found that makes it unsafe to build the entitlement layer on top of the current authorization system. The existing seams (§20) are additive, not corrective.

### P1 — Strongly Recommended Before Subscription
1. **Refactor `PortfolioPolicy` onto `AuthorizationEvaluator`**, replacing the inline admin-bypass duplication with `.platformOverride()`. Portfolio is one of the four modules the entitlement system must directly gate (`CREATE_PORTFOLIO`, and the future public-visibility gate) — building new entitlement logic on top of a policy that already deviates from the shared pattern compounds the drift.
2. **Add a shared admin-route guard** (layout-level or a wrapper util) rather than continuing per-page convention, *especially* before adding any admin-grant-plan UI, which is explicitly required by the product doc (§18 admin plan grants).
3. **Resolve the Portfolio "publicly visible" data-model gap** (§7, §17) as part of entitlement design — decide whether to reuse `visibility` (with a documented interaction rule: entitlement can force PRIVATE-for-public-display without altering the user's own preference) or add a distinct field. This should be decided, not deferred, because it's referenced directly by the product doc's non-destructive-downgrade requirement.
4. **Fix the non-constant-time secret comparison** in `internal/competitions/lifecycle/route.ts` for consistency with the hardened `tick` route (low severity, cheap fix).

### P2 — Can Be Done Alongside Subscription
1. Gate the direct recommendation-generation route explicitly when the Pro+ entitlement is introduced — do not rely on the notification-delivery path's gate alone (§9, §18).
2. Extend the notification scheduler's `findEnabledUserIds`-style query and the job handlers' `isEnabledForUser`-style re-checks with a parallel entitlement check, following the same ID-scoped (no fabricated actor) pattern already established (§8, §14).
3. Add a `countOwnedByUser`-style repository method to `ProjectRepository` for the ownership-only quota count (§6).

### Future
- Fine-grained MCP entitlement scopes beyond the current two (`competitions:read/write`) — extensible without redesign per §10.
- API-key/service-account support, if a future plan tier is meant to unlock programmatic access — currently greenfield (typed but unbuilt).
- Full admin-page audit (only one page was inspected as a representative sample this session) to confirm the "self-check by convention" pattern holds everywhere before relying on it.

---

## 23. Recommended Target Access Architecture

No redesign is warranted. The minimal shape that satisfies the product doc's requirements, built on what already exists:

```
Authentication (SessionService / MCP OAuth / cron secret)
        │
        ▼
Actor / Principal resolution (PlatformContextResolver — already re-reads DB per request)
        │
        ▼
Entitlement resolution  ← NEW: real resolveEntitlements(actor) replacing the {tier:"default"} stub,
        │                      backed by a Plan/Subscription/Grant model (source: subscription | trial |
        │                      admin_grant | coupon | one_time_purchase, per product doc §37)
        ▼
Resource/Platform Authorization (existing AuthorizationEvaluator chain, unchanged)
   — entitlement becomes an additional check consumed via PlatformPermissionSet /
     module policies at the exact seams already flagged in code (CREATE_PORTFOLIO,
     MCP scopes, notification scheduler query, recommendation route, project-create quota)
        │
        ▼
Operation
```

Rate limiting remains a parallel concern, already wired to receive `entitlements` at `resolvePolicy` — implementing the real resolver retroactively activates plan-based rate tiers everywhere, with zero call-site changes.

This directly answers §26 of the requested audit ("where would the entitlement check naturally belong"): **between actor resolution and resource authorization**, exposed as a service the authorization layer (and the notification/recommendation background paths, which bypass that layer by design) can both call — not folded into `PlatformContextResolver` itself (which is authentication-adjacent, not product-access-adjacent), and not replacing `AuthorizationEvaluator` (which remains responsible for ownership/membership/role, a separate concern per the product doc's own §27 conceptual separation).

---

## 24. Stabilization Plan

1. P1 items (§22) — Portfolio policy refactor, admin route guard, Portfolio visibility data-model decision, secret-comparison fix. None are large; all are isolated to one module each.
2. Build the real entitlement resolver behind the existing `lib/entitlements` stub, backed by whatever `Plan`/`Subscription`/`Grant` schema the (separate, not-yet-started) subscription architecture phase designs.
3. Wire the resolver into the flagged seams one at a time (CREATE_PORTFOLIO baseline → MCP scope/permission → notification scheduler + handler re-checks → recommendation route → project-create quota), verifying each against the product doc's specific behavior (e.g., non-destructive downgrade, preference survival) before moving to the next.
4. Re-audit after wiring to confirm no module was left ungated (particularly recommendation generation, per §18's flagged risk).

---

## 25. Final Verdict

1. **Are access decisions centralized?** Yes, for authorization proper — one generic evaluator, one platform policy, consistent per-module policies — with Portfolio as the single documented exception (drift, not a security bypass).
2. **Do MCP, notifications, projects, portfolio and APIs use the same authorization mechanism?** MCP, Projects, Competitions, and API routes: yes, the same `AuthorizationEvaluator`/`PlatformPolicy` chain. Portfolio: functionally similar but implemented as a hand-written switch, not the shared evaluator. Notifications: yes, via `PlatformPolicy` for the one role-gated intent; the delivery *pipeline* (background jobs) intentionally bypasses the actor-based layer entirely by design, using ID-scoped checks instead.
3. **Which modules bypass the common authorization architecture?** Portfolio's policy (implementation-level drift, same outcome). Background job/cron delivery code (architectural, by design — not a flaw, but a boundary to route entitlement checks around explicitly). Internal/cron routes (different trust boundary, appropriate).
4. **Is the current architecture secure enough for subscription work?** Yes — no P0 findings. The one LOW item (non-constant-time secret compare) and the INFO items are hygiene/consistency issues, not exploitable authorization bypasses.
5. **What must be fixed first?** Nothing is a hard blocker; P1 items (§22) are strongly recommended first because they're each small and because two of them (Portfolio policy, Portfolio visibility model) are modules the entitlement system will directly touch.
6. **What can remain unchanged?** Projects, Competitions, MCP's scope-then-reuse pattern, the repository layer, the rate-limit call-site architecture (only the resolver's internals need to change), and the background-job actor-bypass pattern (a correct design to build entitlement checks *around*, not replace).
7. **Where should future entitlement checks live?** A new resolution step between actor resolution and resource authorization (§23), consumed at the already-flagged seams (`CREATE_PORTFOLIO`, MCP scopes/permissions, notification scheduler + handlers, recommendation route, project-create quota) — not as a new parallel authorization system.
8. **Is the architecture ready for Free/Pro/Pro+?** Yes, with the P1 items addressed alongside building the actual entitlement resolver.
9. **Is it ready for future trials?** Structurally yes — the entitlement resolver is designed (per the seams found) to be source-agnostic; trials are just another `resolveEntitlements()` input source, consistent with the product doc's §37 requirement.
10. **Is it ready for admin grants?** Conceptually yes (admin/subscription are already separated), but practically **not yet** without the P1 admin-route-guard fix, since admin-grant UI is exactly the kind of new admin page that currently relies on per-page discipline rather than a structural guard.
11. **Is it ready for future one-time purchases?** Structurally plausible via the same entitlement-source model, though nothing in the current codebase yet models a purchasable unit (e.g. a theme) — greenfield, not blocked by anything found.
12. **What must be stabilized before Razorpay?** Nothing Razorpay-specific was found coupled into the codebase today (no `razorpayPlanId`-style checks exist because no subscription code exists yet) — the requirement to keep Razorpay out of core domain logic is trivially satisfiable by building the entitlement resolver as the sole boundary, per §23, before any billing integration work begins.
