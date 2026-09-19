# Kizunia MCP Server

> **Status:** Stable (foundation) — read tools and write tools implemented; ChatGPT connector configuration is a deployment step, not a code change.
>
> **Version:** 1.0
>
> **Audience:** Backend Developers, Contributors
>
> **Last Updated:** 2026-09-19

---

# Introduction

Kizunia exposes an authenticated [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server so that ChatGPT and other MCP clients can search, read, create, and update Kizunia competitions on behalf of an authenticated Kizunia user.

The MCP server is a **thin, authenticated adapter over the existing Kizunia competition domain**. It introduces no new business rules, no new authorization system, and no new way to reach the database. Every decision an MCP tool makes about *whether an action is allowed* is made by the same `PlatformPolicy` / `CompetitionPolicy` code the REST API and admin console already use.

```
ChatGPT (or any MCP client)
        │  researches competitions on the open web
        │  (Kizunia MCP never does this)
        ▼
Kizunia MCP  ──────────────────────────────────────────────
  search_competitions / get_competition / create_competition / update_competition
        │
        ▼
Better Auth OAuth (this deployment's own authorization server)
        │  bearer token → Kizunia user id + granted scopes
        ▼
Kizunia authorization (PlatformPolicy / CompetitionPolicy — UNCHANGED)
        │
        ▼
CompetitionService → CompetitionRepository → Postgres (UNCHANGED)
```

If MCP were removed entirely, nothing under `src/modules/competitions` would need to change. That is a design requirement, not an accident — see [Architecture](#architecture) below.

---

# Why This Exists

The product goal: a person using ChatGPT should be able to say *"add this hackathon I found on Unstop to Kizunia"*, and have ChatGPT do the web research itself, then call into Kizunia with structured data. Kizunia's job is never to scrape the web — only to authenticate the caller, authorize the action, validate the data against its own domain model, and persist it through the domain it already has.

Two temptations this design deliberately avoids:

1. **A second authorization system keyed on OAuth scopes.** Scopes answer *"was this MCP client allowed to attempt this?"*, never *"may this Kizunia user do this?"*. The second question is answered exactly once, by `PlatformPolicy`/`CompetitionPolicy`, regardless of whether the caller arrived over a session cookie or an MCP bearer token.
2. **An `McpCompetitionService` that duplicates domain logic.** There is no such class. MCP's application layer (`src/modules/mcp/application/*.usecase.ts`) calls `CompetitionService` and the existing authorizers directly.

---

# Architecture

## Layers

```
src/app/api/mcp/route.ts                 ← Transport: Next.js route, Better Auth's withMcpAuth
src/app/.well-known/oauth-*/route.ts     ← OAuth discovery metadata (RFC 8414 / RFC 9728)

src/modules/mcp/
├── config.ts                            ← The only place MCP reads process.env
├── auth/
│   ├── scopes.ts                        ← McpScope enum + parsing (the OAuth capability boundary)
│   ├── authentication.ts                ← Token → McpPrincipal (audience check, scope parsing)
│   └── actor-resolver.ts                ← McpPrincipal → Kizunia StrictAuthorizationActor
│                                            (re-reads role/banned from the DB — never trusts the token)
├── authorization/
│   └── authorize-mcp.ts                 ← requireScope() — the ONLY MCP-specific authorization rule
├── server/
│   ├── context/
│   │   ├── request-context.ts           ← McpRequestContext (principal + actor + requestId)
│   │   └── build-request-context.ts     ← authenticate() → resolveActor(), assembled once per call
│   └── transport/
│       ├── json-rpc.ts                  ← JSON-RPC 2.0 envelope types
│       └── dispatch.ts                  ← initialize / tools.list / tools.call — protocol only
├── tools/
│   ├── types.ts                         ← The McpTool interface every tool implements
│   ├── registry.ts                      ← name → tool lookup
│   └── competitions/*.tool.ts           ← Thin adapters: describe + validate + delegate
├── application/
│   └── *.usecase.ts                     ← Orchestration: scope check → Kizunia authorization → CompetitionService
├── schemas/competitions/                ← Zod input contracts (MCP-specific, never reused by REST)
├── mappers/
│   └── competition-import.mapper.ts     ← MCP import contract → CreateCompetitionInput/UpdateCompetitionInput
├── errors/                              ← MCP protocol errors + domain-error → tool-failure translation
└── observability/events.ts              ← Structured event seam, modelled on src/lib/rate-limit/events.ts
```

## Dependency direction

```
Infrastructure (MCP transport, OAuth)
        ↓
Application (mcp/application/*.usecase.ts)
        ↓
Domain (CompetitionService, CompetitionPolicy, PlatformPolicy — UNCHANGED)
        ↓
Persistence (CompetitionRepository, Prisma — UNCHANGED)
```

Nothing under `src/modules/competitions`, `src/authorization`, or `src/lib` (other than the one line registering the plugin in `src/lib/auth.ts`) knows MCP exists. `McpTool`, `McpRequestContext`, `JsonRpcRequest` and every other MCP-specific type live only inside `src/modules/mcp`.

## Why inside the Next.js app, not a separate service

MCP tools need the same actor resolution, the same authorization policies, and the same Prisma-backed services the REST API already uses. Running MCP as a separate process would mean either duplicating all of that or calling back into this application over the network — both strictly worse than one more route handler in the app that already owns the domain. This mirrors the existing internal-jobs pattern (`docs/architecture/workflows/internal-jobs.md`): new capability, same application.

---

# Authentication

Kizunia's Better Auth instance (`src/lib/auth.ts`) is configured with Better Auth's `mcp` plugin, which composes its OAuth 2.1 / OIDC authorization-server plugin. This makes **this Kizunia deployment its own OAuth authorization server** for MCP clients — no third-party identity provider is involved.

```
ChatGPT                Kizunia (Better Auth)              Kizunia MCP tool
   │                           │                                  │
   │ 1. GET /.well-known/oauth-protected-resource                 │
   │──────────────────────────>│                                  │
   │ 2. discovers authorization_endpoint, token_endpoint           │
   │                           │                                  │
   │ 3. dynamic client registration (RFC 7591)                    │
   │──────────────────────────>│                                  │
   │ 4. redirects user to Kizunia sign-in + consent (PKCE, S256)  │
   │<──────────────────────────│                                  │
   │ 5. user signs in with their EXISTING Kizunia account          │
   │ 6. authorization code → access + refresh token                │
   │──────────────────────────>│                                  │
   │ 7. POST /api/mcp  Authorization: Bearer <token>                │
   │─────────────────────────────────────────────────────────────>│
   │                                                    8. withMcpAuth
   │                                                       validates token
   │                                                       exists/unexpired
   │                                                    9. authenticateMcpToken:
   │                                                       audience check,
   │                                                       scope parsing
   │                                                   10. McpActorResolver:
   │                                                       RE-READ role/banned
   │                                                       from Postgres
```

Key points:

- **The human, never the MCP client, proves identity.** Step 5 happens on Kizunia's own `/sign-in` page, using whatever Kizunia already supports (email/password, Google, GitHub).
- **PKCE (S256) is required.** Enforced by Better Auth's OIDC provider for public clients — the standard mitigation for authorization-code interception.
- **Audience validation (RFC 8707).** `authenticateMcpToken` (`src/modules/mcp/auth/authentication.ts`) rejects a token recorded for a different resource, which is what stops a token minted for some other OAuth-protected resource on this same authorization server from being replayed against Kizunia's MCP endpoint (the "confused deputy" problem RFC 8707 exists to prevent).
- **No cached role.** `McpActorResolver` re-reads `role` and `banned` from Postgres, through the same `PlatformContextResolver` every session-based request uses, on *every* tool call. A user demoted or banned after a token was issued loses that authority on their very next call — not after the token happens to expire.

---

# Authorization

Two independent checks run for every write, and both must pass:

```
                    ┌─────────────────────────────┐
                    │ 1. OAuth scope check          │
                    │    requireScope()             │
                    │    "was this MCP client       │
                    │     allowed to ASK for this?" │
                    └───────────────┬───────────────┘
                                    │ pass
                                    ▼
                    ┌─────────────────────────────┐
                    │ 2. Kizunia authorization       │
                    │    PlatformPolicy /            │
                    │    CompetitionPolicy           │
                    │    "may THIS USER do this,     │
                    │     right now?"                │
                    └───────────────┬───────────────┘
                                    │ pass
                                    ▼
                          CompetitionService
```

A granted scope can only **narrow** what a client may attempt; it can never **widen** what a user is allowed to do. A `competitions:write` token held by an ordinary `USER` still cannot create a competition, because `PlatformPermissionSet[USER]` does not contain `CREATE_COMPETITION` — exactly the same reason an ordinary user's session cookie can't do it on the REST API today.

## Scopes (`src/modules/mcp/auth/scopes.ts`)

| Scope | Grants |
|---|---|
| `competitions:read` | May call `search_competitions` / `get_competition`. |
| `competitions:write` | May call `create_competition` / `update_competition` — subject to Kizunia authorization below. |

## Kizunia authorization, reused as-is

| Tool | Authorization call | Same code path as |
|---|---|---|
| `search_competitions` | none (public search, already scoped server-side) | `CompetitionController.search` |
| `get_competition` | `CompetitionPolicy.canView` via `CompetitionService.findPublicBySlug` | the public competition detail page |
| `create_competition` | `CompetitionAuthorizer.create` → `PlatformPolicy` → `PlatformAction.CREATE_COMPETITION` | `CompetitionController.create` |
| `update_competition` | `CompetitionAuthorizer.edit` → `CompetitionPolicy.canManage` (membership OR platform override) | `CompetitionController.update` |

## Current effective permissions

- **Selected MCP users** (ordinary `USER`/`MODERATOR` role, granted an MCP client): can read if given `competitions:read`. Cannot create — `PlatformPermissionSet` grants `CREATE_COMPETITION` only to `ADMIN`/`SUPER_ADMIN`. Cannot update a competition unless they hold a `CompetitionMember` row on it (`OWNER`/`ORGANIZER`/`MAINTAINER`) — since `create_competition` grants no membership today, in practice this means an ordinary MCP user cannot create, and can only update competitions they already maintain through the ordinary web console.
- **ADMIN / SUPER_ADMIN**: can read, create, and update any (non-deleted) competition, via `platformOverride()` in `CompetitionPolicy`/`PlatformPolicy` — identical to their existing REST/admin-console authority.

Nothing above is MCP-specific configuration — it is a direct read of `src/authorization/platform/permission-set.ts` and `src/modules/competitions/backend/authorization/permission-set.ts`, unmodified by this feature.

---

# MCP Tools

All four tools are registered in `src/modules/mcp/tools/registry.ts`.

## `search_competitions`

- **Purpose:** Search Kizunia's public competition catalogue.
- **Scope required:** `competitions:read`.
- **Input:** `query?`, `modes?`, `statuses?`, `difficultyLevels?`, `registrationFeeTypes?`, `registrationTypes?`, `organizerTypes?`, `certificateTypes?`, `registrationPlatforms?`, `eligibilities?`, `categories?` (slugs), `technologies?` (slugs), `page?`, `limit?` (max 50).
- **Output:** `{ items: CompetitionCardDTO[]; pagination }` — the same shape/pagination the public search API returns.
- **Underlying call:** `CompetitionService.search` (unauthenticated, public scope — identical to the marketing site's search).

## `get_competition`

- **Purpose:** Full detail of one competition.
- **Scope required:** `competitions:read`.
- **Input:** `{ slug: string }`.
- **Output:** `CompetitionDetailDTO` (description, content, categories, technologies, eligibilities, locations, assets).
- **Underlying call:** `CompetitionService.findPublicBySlug`, which applies `CompetitionPolicy.canView` — PRIVATE/ARCHIVED competitions are not returned to a non-member caller, identical to the public detail page.

## `create_competition`

- **Purpose:** Create a competition from structured data an MCP client has already researched and extracted.
- **Scope required:** `competitions:write`, **and** the Kizunia actor must hold `PlatformAction.CREATE_COMPETITION` (currently ADMIN/SUPER_ADMIN only).
- **Input:** the [import contract](#the-import-contract) — only `title` is required.
- **Output:** the created competition's edit DTO (same shape `CompetitionController.update` returns).
- **Behavior:** the row is created `PRIVATE` (Kizunia's schema default) — this is Kizunia's existing draft state. MCP never sets `visibility`; publishing remains a deliberate, separate action a human takes in the admin console.

## `update_competition`

- **Purpose:** Patch an existing competition, addressed by its current slug.
- **Scope required:** `competitions:write`, **and** the Kizunia actor must be a member (`OWNER`/`ORGANIZER`/`MAINTAINER`) of the target competition or hold platform ADMIN/SUPER_ADMIN authority.
- **Input:** `{ target: { slug }, patch: <partial import contract> }` — only fields present in `patch` are changed.
- **Output:** the updated competition's edit DTO.
- **IDOR note:** the target is resolved by `CompetitionContextResolver.resolveBySlug`, which loads the actor's *actual* membership on *that* competition from the database before any authorization decision is made — an MCP caller cannot affect a competition merely by knowing its slug unless Kizunia's own membership/role model already permits it.

## The import contract

`src/modules/mcp/schemas/competitions/competition-import.schema.ts` defines the **only** shape MCP will accept for competition data — never a raw `Record<string, unknown>`. It mirrors the validation rules of Kizunia's own `create-competition.ts`/`update-competition.ts` schemas and the `Competition` Prisma model exactly, covering: `title`, `slug` (optional — derived from the title when omitted), `shortDescription`, `organizer`, `organizerType`, `website`, `registrationLink`, `registrationPlatform`, `registrationFeeType`, `registrationFee`, `prizePool`, `mode`, `difficulty`, `certificateType`, `minTeamSize`, `maxTeamSize`, `startDate`/`endDate`/`registrationStartDate`/`registrationDeadline` (ISO 8601 strings), and `content`.

**Deliberately excluded**, and why:

- `registrationType` — exists on the `Competition` model and in search filters, but is not yet wired into `UpdateCompetitionSchema` or `CompetitionRepository.update`. MCP does not get a wider write surface than Kizunia's own admin console.
- Categories, technologies, eligibilities, locations, media assets — each already has its own attach/detach service and its own authorization action (`MANAGE_TECHNOLOGIES`, `MANAGE_ELIGIBILITY`, …), distinct from plain `EDIT`. A natural second wave of MCP tools, not folded into this one payload.
- Any dedicated "source/provenance" field — **the `Competition` model has none.** `website` and `registrationLink` are the only fields that can honestly carry where imported information came from, and only when the source genuinely is the organizer's own site or registration page. See [Provenance](#provenance-and-audit) below.

---

# Provenance and Audit

Kizunia's `Competition` model was audited for provenance fields. It has:

- `createdById` / `createdBy`, `updatedById` / `updatedBy` — who created/last touched the row. **Populated** by every MCP write, because `create_competition`/`update_competition` go through the exact same `CompetitionService.create`/`update` calls the REST API uses, with the resolved Kizunia actor's id.
- `createdAt` / `updatedAt` — standard timestamps.
- **No field for "source URL a human didn't type"** (no `sourceUrl`, `externalId`, or import-metadata column exists).

No new provenance subsystem was introduced. If Kizunia later needs to answer "which competitions were imported via MCP, from where", the honest way to add that is a schema migration adding an explicit field — not an ad hoc convention layered onto `website`.

What IS recorded today: every MCP tool call (success or failure) emits a structured event (`src/modules/mcp/observability/events.ts`) carrying `requestId`, `tool`, `clientId`, and `userId` — enough to answer "who, through which connector, called which tool, when" from logs, without needing a database column.

---

# Security Model

| Threat | Mitigation |
|---|---|
| Token replay against the wrong resource | RFC 8707 audience check in `authenticateMcpToken` |
| Authorization-code interception | PKCE (S256), enforced by Better Auth's OIDC provider |
| Stale/forged role claims in a token | Role/banned state is re-read from Postgres on every call (`McpActorResolver`), never taken from the token |
| Privilege escalation via OAuth scope | Scopes only narrow; every write still re-runs `PlatformPolicy`/`CompetitionPolicy` |
| IDOR (editing a competition by guessing its slug) | `CompetitionContextResolver.resolveBySlug` loads real membership before any decision; `CompetitionPolicy.canManage` denies non-members |
| Mass assignment | The Zod import contract is a fixed, audited field list — no `Record<string, unknown>` path exists anywhere in MCP |
| Banned actor | `CompetitionPolicy`/`PlatformPolicy`'s existing `ACCOUNT_BANNED` check runs unchanged; MCP adds no bypass |
| Deleted competition | `CompetitionContextResolver` queries only non-deleted rows for ordinary edit; `CompetitionPolicy.canManage`'s `RESOURCE_DELETED` guard is unchanged |
| Deleted Kizunia user, still-valid token | `McpActorResolver` converts a resolution failure into `McpUnauthorizedError` rather than crashing or defaulting to some role |
| Information disclosure via error messages | `toMcpToolFailure` forwards only errors already written to be caller-facing (`AppError` with a non-internal category, plus Zod validation issues); every other error — Prisma errors, stack traces, unexpected exceptions — collapses to one opaque `INTERNAL_ERROR` message, logged server-side instead |
| Unsafe content injection | MCP writes free text into the same `content`/`shortDescription` fields the admin console writes into; sanitization/rendering is unchanged and out of scope for this feature |
| Rate limiting | Not yet added at the MCP transport (see Remaining Work). Kizunia's `RateLimitPolicyId` registry is the established pattern to extend when needed. |
| Log/audit leakage | The observability seam (`observability/events.ts`) explicitly never logs tokens, request/response payloads, or free text — only ids and stable error codes |

---

# Local Development

1. No new environment variables are required (see `.env.example`) — MCP reuses `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`.
2. Apply the migration: `pnpm prisma migrate deploy` (or `dev`) to create the `oauth_application`, `oauth_access_token`, `oauth_consent` tables.
3. Start the app: `pnpm dev`.
4. Discovery: `curl http://localhost:3000/.well-known/oauth-protected-resource` and `curl http://localhost:3000/.well-known/oauth-authorization-server`.
5. Register a client (RFC 7591 dynamic registration — this is what an MCP client does automatically):
   ```bash
   curl -X POST http://localhost:3000/api/auth/oauth2/register \
     -H "Content-Type: application/json" \
     -d '{"client_name":"Local MCP test","redirect_uris":["http://localhost:PORT/callback"]}'
   ```
6. Complete the authorization-code + PKCE flow as any OAuth 2.1 client would (Better Auth's own docs cover the generic flow; the Kizunia-specific pieces — login page, scopes, resource — are all configured in `src/lib/auth.ts`).
7. Call the endpoint: `POST /api/mcp` with `Authorization: Bearer <access_token>` and a JSON-RPC body, e.g. `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`.

## Connecting ChatGPT (deployment step, not a code change)

Point ChatGPT's MCP connector configuration at `https://<your-deployment>/api/mcp`. ChatGPT performs discovery and dynamic client registration itself; the human then signs in on Kizunia's own `/sign-in` page and grants consent. **`BETTER_AUTH_URL` must be the deployment's real public origin** before this works — the resource identifier and audience check are both derived from it.

---

# Testing

Unit tests (`pnpm test`, no database required) cover:

- `auth/scopes.test.ts` — scope parsing, identity-scope filtering, malformed input.
- `auth/authentication.test.ts` — audience validation (match, mismatch, absent, normalization), missing-user rejection.
- `auth/actor-resolver.test.ts` — role/ban re-resolution, stale-role override, deleted-user → `McpUnauthorizedError`.
- `authorization/authorize-mcp.test.ts` — the scope gate in isolation.
- `errors/to-tool-failure.test.ts` — which errors are forwarded verbatim vs. collapsed to `INTERNAL_ERROR`.
- `mappers/competition-import.mapper.test.ts` — slug derivation/disambiguation, field mapping, create/update payload shaping.
- `schemas/competitions/competition-import.schema.test.ts` — contract validation, including a mass-assignment attempt (extra keys are stripped, never applied).
- `application/*.usecase.test.ts` — **the real `PlatformPolicy`/`CompetitionPolicy` chain**, with only DB-touching resolvers/services mocked: SUPER_ADMIN success, ordinary-USER denial, banned-actor denial, stale-role-is-ignored, IDOR denial (non-member editing by slug), soft-deleted-competition denial, empty-patch rejection.
- `server/transport/dispatch.test.ts` — JSON-RPC envelope handling, `tools/list`, input-schema validation before `execute`, tool failures returned as `isError: true` rather than protocol errors.

Run: `pnpm test` (or `pnpm --filter next test` from the repo root). All 76 MCP tests pass alongside the existing 163 non-MCP unit tests with zero regressions.

Integration/E2E: not added. The domain calls MCP delegates to (`CompetitionService.create`/`update`) already have their own `*.integration.test.ts` coverage; a full OAuth-flow E2E test would need a running Postgres and a real HTTP round trip and is listed under Remaining Work.

---

# Remaining Work

- **Rate limiting at the MCP transport.** Not yet added. Extending `src/lib/rate-limit/policies.ts` with an MCP-scoped policy (per-user or per-client) is the established pattern; deferred because the write tools are already gated by Kizunia authorization and the read tools reuse `COMPETITIONS_SEARCH`'s existing public rate limit indirectly through `CompetitionService.search`.
- **End-to-end OAuth flow test against a real ChatGPT connector.** Requires a publicly reachable `BETTER_AUTH_URL` and cannot be exercised from local development; the code path is otherwise fully covered by unit tests down to `withMcpAuth`'s own boundary.
- **Granting MCP users competition membership on create.** Today, `create_competition` (like the REST API) does not add the creating actor as a `CompetitionMember`, so a freshly created competition can only be edited afterward by an ADMIN/SUPER_ADMIN or someone explicitly added as a member. This mirrors existing REST behavior exactly and was not changed by this feature; addressing it is a `CompetitionService.create` change, not an MCP change.
- **A second wave of MCP tools** for categories/technologies/eligibilities/locations/media, each reusing its existing attach/detach service and authorization action, once the first wave has real usage to learn from.
