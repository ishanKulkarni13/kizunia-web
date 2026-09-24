**# Portfolio Architecture Audit

> **Audit type:** Architecture / correctness / security / documentation audit of the Portfolio module
> **Scope:** `next/src/modules/portfolio/**`, its routes (`next/src/app/api/v1/portfolio/**`), pages (`next/src/app/(dashboard)/(portfolio)/**`), Prisma models and migrations, and every place another module touches Portfolio (Assets target authorization, Technologies, Projects visibility predicate)****
> **Audited state:** branch `feat/portfolio-v3`, identical to `main` at `e1ea28e` (working tree clean apart from this file)
> **Method:** Static repository inspection: code reading, `git log`, `git show` of unmerged branches. **Nothing was executed** (no build, tests, migrations, or runtime requests). Any claim that depends on runtime behaviour is labelled *unverified*.
> **Change footprint:** This file only. No code, schema, migration, test, or other documentation was modified. No commits were made.
> **Finding IDs:** `PF-AUD-001` … `PF-AUD-021` (numbered findings) and `INFO-A` … `INFO-G` (observations). Severity scale: P0 critical / P1 important / P2 meaningful / P3 minor / INFO.

---

## 0. Corrections to the premises of this audit

Three assumptions in the audit brief do not match the repository at the audited commit. They are stated first because they change how several sections should be read.

1. **There is no centralized logger on the audited branch.** A logger exists only on the **unmerged** branch `feat/logger` (five commits: `d086870` foundation, `2b08359` tests, `19657f9` competitions wiring, `ceb7eea` auth/session wiring, `bcfe280` fixes). On `main`, three independent hand-rolled seams exist (`lib/rate-limit/events.ts`, `modules/mcp/observability/events.ts`, `modules/notifications/observability/log.ts`), and `ErrorHandler` (`lib/errors/error-handler.ts`) still calls `console.error` for unhandled errors. See §11.
2. **There is no Subscription implementation in code.** Subscription exists only as design documents on the unmerged `origin/docs/suscriptions-payments` branch (`docs/architecture/decisions/subscription-billing.md`, `docs/architecture/domain/subscription/**`). The only in-code seams are `lib/entitlements/index.ts` (always returns the default tier), `PlatformAction.CREATE_PORTFOLIO`, and `resolvePortfolioPublicEligibility()` (always `true`). See §12.
3. **A service that calls `prisma.$transaction(...)` and hands a transaction client to a repository is the repository-wide standard, not a Portfolio shortcut.** Projects, Competitions, Notifications, Assets, Users and Technologies services all do exactly this (18 service files import `@/lib/prisma`; every Portfolio service uses it only to open transactions and never to query). This audit therefore does **not** treat "service imports Prisma" as a defect.

---

## 1. Executive Summary

**What Portfolio implements today.** A per-user portfolio (0..1 per user) with: create, read-own, and profile update (display name, headline, bio, phone, public contact email, location, resume PDF); three complete owner-managed sub-resources (**Projects**, **Testimonials**, **Technologies**) each with list/add/update/reorder/remove; an authorization stack built on the shared evaluator; a public read API (`GET /api/v1/portfolio/[username]`) with an explicit hand-mapped DTO and layered visibility enforcement; and an editor UI for Profile, Projects, Testimonials and Technologies.

**What it does not implement.** No public Portfolio page (the URL the UI advertises, `kizunia.com/u/{username}`, does not exist). No way to change `visibility` and no way to delete or restore a Portfolio. Links, Education, Experience, Achievements, Certifications and Settings are *foundation only*: Prisma models, public-DTO fields (always empty), Asset purposes and Asset reference-checker entries exist, but there is no service, API or UI; their editor tabs are placeholders.

**Overall architectural condition.** The parts of Portfolio built recently (Projects, Testimonials, Technologies sub-resources; the authorization stack consolidated in #102) are aligned with, and in several respects tighter than, the rest of the repository. The core aggregate, i.e. what `GET /me`, `POST /` and `PATCH /profile` return, is the outlier: it is a raw Prisma entity passthrough that predates the project's own "DTOs never expose Prisma models" rule, and it is over-fetching, unfiltered by project membership, and contradicts the module's own documentation. There is **no P0** finding: no cross-user write path was found, every mutation resolves the portfolio from the session, and every sub-resource write is scoped by composite key or `portfolioId`.

**Major risks (all P1).**
- `PF-AUD-001`: the editor DTO is a raw Prisma tree with no ProjectMember filter (latent data exposure; heavy query on every editor call).
- `PF-AUD-002`: document (resume) URLs are emitted as raw `secureUrl`, which the Assets module itself documents as returning `401` for `DOCUMENT` assets. Users cannot actually view an uploaded resume through Portfolio.
- `PF-AUD-003`: portfolio visibility and lifecycle are uncontrollable: every Portfolio defaults to `PUBLIC`, nothing can change that, and there is no delete path, while the public API is already live.

**Recommendation.** Stabilise first, briefly and narrowly. Four items should be settled before more Portfolio features are added (§15): the editor DTO and query (`PF-AUD-001`), the document URL path (`PF-AUD-002`), the visibility/lifecycle write paths and their product decisions (`PF-AUD-003`/`013`), and the reserved-username/route namespace (`PF-AUD-011`). Everything else can proceed in parallel with feature work. The recently built sub-resource pattern is a sound template for the remaining sections (Education, Experience, Achievements, Certifications, Links) and should be preserved unchanged (§18).

---

## 2. Repository Architecture Baseline

The repository is the reference. This is what it actually does today, established by reading the code.

### 2.1 Layering and module shape

- `next/src/modules/<feature>/` is a vertical slice (`backend/`, `frontend/`, `api/`, `schemas/`, `errors/`, DTOs). `docs/architecture/folder-structure.md` states the intended flow: **Route Handler → Controller → Service → Repository → Database**, and Portfolio follows it.
- **Controller** (`Route.execute` wrapper, `SessionService.getStrictActor`, zod `parse`, optional `rateLimitService.enforce`, `ApiResponse`), never business logic.
- **Service**: authorizer call + business rules + `prisma.$transaction` where multiple writes must be atomic, constructing `new Repository(tx)` inside the transaction.
- **Repository**: constructor takes `PrismaClient | Prisma.TransactionClient`; data access only.
- **Mapper** invoked from the service; DTO rule in `modules/projects/backend/dto/README.md`: DTOs are plain interfaces, "DTOs never expose Prisma models", "Services only consume and return DTOs".

### 2.2 Authorization

`src/authorization/` provides `AuthorizationEvaluator` (chain: `security`, `platformOverride`, `permission`, `require`, `grant`, `evaluate`), `Authorization.assert` (throws `ForbiddenError`), `PlatformAccess.canBypassAuthorization` (ADMIN/SUPER_ADMIN), and platform actions/permission-set. Each resource module owns `actions / context / context-resolver / policy / authorizer / permission-resolver`. Portfolio's was consolidated onto this evaluator in `c956336` (#102, 2026-09-20): it is current.

### 2.3 Errors, HTTP, rate limiting

`lib/errors` (`AppError` + category subclasses, `ErrorHandler`, `createErrorResponse`, zod conversion), `lib/http` (`ApiResponse`, `Route`, client `HttpClient`/`ApiError`), `lib/rate-limit` (policy registry, Postgres store, per-policy failure mode, headers). Modules with typed error catalogs: Projects, Technologies, Notifications (`error-code.ts`).

### 2.4 Assets

Assets are shared, reusable rows with an explicit lifecycle (`ACTIVE → DETACHED → DELETING → DELETED`). Every attach path validates the asset (`assertAssetReferenceAllowed`, fast-fail) and then, inside the transaction, locks and re-validates (`AssetService.prepareAssetAttach`) and afterwards calls `detachIfUnreferenced` on the previous asset. Ownership (`uploadedBy`) is deliberately never an authorization signal (`assets/backend/reference-policy.ts` header; `docs/architecture/domain/assets/lifecycle.md`). Upload authorization per purpose lives in `assets/backend/target-authorization.ts`.

### 2.5 Tests

Vitest with two tiers: unit (`*.test.ts`, no DB, `vitest.config.mts`) and integration (`*.integration.test.ts`, real Postgres via `DATABASE_TEST_URL`, `fileParallelism: false`, `vitest.integration.config.mts`). Conventions in `next/docs/testing/{README,conventions,database}.md`. A legacy tier of standalone `scripts/verify-*.ts` files run with `tsx` still exists. There is no CI configuration in the repository.

### 2.6 Reference modules

| Module | Why it is relevant to Portfolio |
|---|---|
| **Projects** | Closest sibling. Portfolio's sub-resource services/repositories mirror Project Links / Technologies / Testimonials (`portfolio-*.service.ts` files cite them). Owns `publiclyListableProjectWhere` (`projects/backend/visibility.ts`), which Portfolio consumes. |
| **Notifications** | Most mature module: rate limit on every route, `errors/error-code.ts` catalog, ISO-string DTOs with a written rationale, ports/adapters, structured event logging, extensive tests. Shows the ceiling of current conventions. |
| **Assets** | Owns the attach/detach lifecycle Portfolio must follow; owns `reference-checker`/`reference-metadata` which already enumerate Portfolio's asset slots. |
| **Technologies** | Owns the catalog, soft delete and `findActiveById` that Portfolio's Technology attach uses. |
| **Competitions** | Broadest use of the shared patterns (4 `$transaction` sites in one service, per-endpoint rate limiting). |

---

## 3. Portfolio Capability Inventory

| Capability | Backend | Frontend | DB | API | Auth | Docs | Status |
|---|---|---|---|---|---|---|---|
| Create portfolio | `PortfolioService.create`; race-safe unique backstop (`P2002`/`P2014`) | `PortfolioEmptyState` + `usePortfolioCreationFlow` (forces username first) | `portfolio` (`userId @unique`) | `POST /api/v1/portfolio` (no body; `createPortfolioSchema` unused) | `PlatformAction.CREATE_PORTFOLIO` + `PortfolioAuthorizer.create` (banned denied) | Documented (`portfolio.md` Ownership) | **Implemented** |
| Read own | `PortfolioService.findMine` | `usePortfolioStore.getMine`, editor layout | same | `GET /api/v1/portfolio/me` (404 when none) | `PortfolioAuthorizer.read` (owner) | Documented | **Implemented** (raw entity DTO, `PF-AUD-001`) |
| Profile update | `updateProfile` (asset lock + write + detach in one tx) | `ProfileEditor` + `portfolio-profile.store` (dirty tracking, shared zod schema) | scalar columns on `portfolio` | `PATCH /api/v1/portfolio/profile` | `PortfolioAuthorizer.edit` | Documented | **Implemented** |
| Resume (PDF) | `assertAssetReferenceAllowed` + `prepareAssetAttach` (`PORTFOLIO_RESUME`) | `DocumentUploader` in `ProfileEditor` (no view link) | `portfolio.resumeAssetId` (FK `SET NULL`) | via `PATCH /profile` | upload: `target-authorization` → `PortfolioAuthorizer.edit` | `assets/policies.md` says no flow exists (stale) | **Partial**: write path works, **view URL unusable** (`PF-AUD-002`) |
| Projects | `PortfolioProjectService` + `PortfolioProjectRepository` | `PortfolioProjectsSection`, `portfolio-projects.store` | `portfolio_project` (composite PK, `@@index(portfolioId, displayOrder)`) | `GET/POST/PATCH /projects`, `PATCH/DELETE /projects/[projectId]` | `MANAGE_PROJECTS` + active-membership check on add/feature | Well documented | **Implemented** |
| Testimonials | `PortfolioTestimonialService` + repo | `PortfolioTestimonialsTab`, form dialog, store | `testimonial` (nullable `portfolioId`/`projectId`, indexes) | `GET/POST/PATCH /testimonials`, `PATCH/DELETE /testimonials/[id]` | `MANAGE_TESTIMONIALS`; image via `PORTFOLIO_TESTIMONIAL_IMAGE` | Documented | **Implemented** |
| Technologies | `PortfolioTechnologyService` + repo | `PortfolioTechnologiesSection`, add/edit dialogs, store | `portfolio_technology` (composite PK; no timestamps) | `GET/POST/PATCH /technologies`, `PATCH/DELETE /technologies/[id]` | `MANAGE_TECHNOLOGIES` (Portfolio side only) + `findActiveById` on add | `technology.md` yes; `portfolio.md` still calls the tab a placeholder | **Implemented** (doc stale) |
| Public read | `findPublicByUsername` (policy first, then SQL-filtered fetch) + `toPublicDto` | **none**: no page; `PortfolioTestimonials` and `PortfolioApi.getPublic` unused | n/a | `GET /api/v1/portfolio/[username]` (anonymous; 60 req/min/IP) | `PortfolioPolicy.canView` via anonymous context; every denial → 404 | Documented (acknowledges no page) | **Backend only** |
| Visibility change | none | none (Settings tab is a placeholder) | `portfolio.visibility` (default `PUBLIC`) | none | none | Documented as user-controllable | **Missing** (`PF-AUD-003`) |
| Delete / restore | `repository.softDelete` (no caller); `PortfolioAction.DELETE` (no caller) | none | `portfolio.deletedAt` | none | policy branch exists | Documented as existing flow | **Missing** (`PF-AUD-003`, `013`) |
| Username / public URL | delegated to Better Auth `username` plugin | `UsernameDialog` → `authClient.updateUser` | `user.username @unique` | Better Auth endpoint | Better Auth session; validator reserves only `admin` | Documented | **Implemented (external)**; namespace risk `PF-AUD-011` |
| Links | none | placeholder tab | `link.portfolioId` (+ index, cascade) | none | none | listed as owned content | **Foundation** |
| Education | none | placeholder | `portfolio_education` (+ logo asset FK) | none | asset purpose + upload authorization exist | listed | **Foundation** |
| Experience | none | placeholder | `portfolio_experience` (+ logo asset FK) | none | same | listed | **Foundation** |
| Achievements | none | placeholder | `portfolio_achievement` (+ asset FK; no `updatedAt`) | none | same | listed | **Foundation** |
| Certifications | none | placeholder | `portfolio_certification` (+ asset FK; no `updatedAt`) | none | same | listed | **Foundation** |
| Settings (theme, accent, section order, hidden sections) | none | placeholder | `portfolio_settings` (1:1, never created by code) | none | none | listed | **Foundation** |
| Statistics, Teams, Blogs, Hackathons, verification badges, search | none | none | none | none | none | Documented as future | **Documentation only (future)** |

### 3.1 Capability detail (selected)

**Lifecycle.** Create: owner-only, once per user; a duplicate maps to `PortfolioAlreadyExistsError` (409). Read: owner only via `/me`. Update: profile fields only. Delete/restore: the schema (`deletedAt`), policy (`PortfolioAction.DELETE`) and repository (`softDelete`) exist, but nothing calls them.

**Ownership and creation rules.** `Portfolio.userId @unique` enforces 0..1 at the database; the service pre-check is a fast-fail and the repository translates the unique violation, so the invariant does not rely on application code alone. Creation does not require a username (backend), but the frontend flow forces one first. `displayName` defaults from `user.name`.

**Technologies.** Add requires the technology to be active (`TechnologyRepository.findActiveById`). Remove is unconditional so stale references to a since-deleted technology can always be cleared. Reorder is an exact-cover check inside a transaction. Metadata (`startedUsingAt`, `description`) is per-relationship. Deleted-technology *read* handling: see `PF-AUD-005`.

**Projects.** Add/feature require a `ProjectMember` row (any role); remove requires only ownership. The membership invariant is enforced at *query time* on the dedicated endpoint and on the public query (not on the editor aggregate, see `PF-AUD-001`). Public rendering composes `publiclyListableProjectWhere` (not deleted, `PUBLIC`, `PUBLISHED`) plus `hidden: false` plus owner-membership.

**Testimonials.** Portfolio-owned; the person quoted is not a Kizunia user and is unverified (`INFO-D`). Image is an optional asset with a full attach/replace/detach lifecycle inside transactions.

**Public Portfolio.** API, DTO and mapper are complete; no page, no public components mounted (only an unused `PortfolioTestimonials`). Visibility enforcement: `PortfolioPolicy.canView` (deleted, owner banned, `PRIVATE`, eligibility seam), plus a SQL pre-filter (`visibility PUBLIC`, `deletedAt null`, owner `banned: { not: true }`). Every denial is `PortfolioNotFoundError` (404) by design so existence of a private portfolio is not leaked.

---

## 4. Portfolio Documentation Audit

Documents inspected: `docs/architecture/domain/portfolio.md` (v1.1, "Stable", last updated 2026-09-07 in its header; last touched by commit `e158594` on 2026-09-10), `docs/project/feature-specification/portfolios.md`, `docs/architecture/domain/technology.md`, `docs/architecture/domain/project.md`, `docs/architecture/domain/user.md`, `docs/architecture/domain/assets/{overview,lifecycle,policies,upload,security}.md`, `docs/architecture/authorization/*`, `docs/architecture/domain/relationships.md`, `docs/architecture/folder-structure.md`, `docs/project/feature-specification/users.md`, `docs/legal/README.md`, `next/src/modules/portfolio/README.md`, `next/docs/testing/*`, plus header comments in `scripts/verify-portfolio-*.ts`.

### 4.1 Correct (documentation matches implementation)

- Ownership: 0..1 Portfolio per user; creation is explicit; gated by `PlatformAction.CREATE_PORTFOLIO` (`portfolio.md` Ownership; `service.ts create`).
- Portfolio Projects: eligibility (any active member), the two independent checks, remove-without-membership, editor-vs-public queries, `publiclyListableProjectWhere` reuse, soft-deleted projects filtered on read, `removeForMembershipEnd` seam present and unused (`portfolio.md` Portfolio Projects; `portfolio-project.repository.ts`, `service.ts`; `project.md` §Membership).
- Testimonials: shared `Testimonial` table with nullable parents, separate repositories/services, owner-only `MANAGE_TESTIMONIALS`, exact-cover reorder inside a transaction, hard delete, image via Asset system.
- Visibility: two levels only; `UNLISTED` removed and migrated to `PRIVATE` (`20260907120000_remove_portfolio_unlisted_visibility`); banned owner never public; enforced at the repository and policy, not the frontend.
- Public contact fields are intentionally public and independent of account email; the public DTO is hand-mapped.
- Editor-vs-public API split; no id-based editor route; portfolio always resolved from the session.
- Route-driven editor tabs matching the Project editor convention.
- `technology.md`: `PortfolioTechnology` semantics (owner-curated, never derived from `ProjectTechnology`), `PortfolioAction.MANAGE_TECHNOLOGIES` vs `PlatformAction.MANAGE_TECHNOLOGIES` split, unconditional detach.

### 4.2 Stale (described behaviour has changed)

| Location | Claim | Reality |
|---|---|---|
| `portfolio.md` §Frontend Editor | Technologies is a placeholder tab | Fully implemented (`portfolio-technologies-section.tsx`, store, API, routes) |
| `portfolio.md` §Portfolio Testimonials / Data model | "see the comment on the `Testimonial` model in `schema.prisma`" for the XOR rationale | No such comment exists on the model |
| `portfolio.md` §Testimonials Data model | testimonial `displayOrder` default 100 "matching `PortfolioProject`'s append-at-the-end convention" | Projects and Technologies append starting at `0`; Testimonials start at `100` (`nextDisplayOrder` in each repository) |
| `assets/policies.md` "Worked Example: `PORTFOLIO_RESUME`" | "there is currently no resume upload flow in the codebase at all… see the commented-out `resumeAsset` block in `modules/portfolio/backend/service.ts`" | A complete flow exists (`DocumentUploader`, `PORTFOLIO_RESUME` policy, `updateProfile` with `prepareAssetAttach`). The commented block in `create` is unrelated to it |
| `next/src/modules/portfolio/README.md` | Folder tree with `api/`, `components/`, `store/` at module root; `backend/{mapper,permissions,errors}.ts` as live files | Code lives under `frontend/`; those three backend files are empty placeholders (`mapper/mapper.ts` and `errors/errors.ts` are the real ones); the public barrel `index.ts` is empty |
| `scripts/verify-portfolio-*.ts` headers | "There is no test runner in this repository yet" | Vitest unit + integration tiers exist |
| `portfolio.md` header | Version 1.1 / `Status: Stable` / Last Updated 2026-09-07 | Predates Technologies (#68), testimonials v2 docs, and #102 (banned-actor rule, eligibility seam). "Stable" overstates a module with several unbuilt documented capabilities |

### 4.3 Contradictory (documentation and implementation disagree)

| Documentation | Implementation |
|---|---|
| `portfolio.md` §Ownership: "A banned user is **not** automatically prevented from editing an existing Portfolio — only from creating a new one" | `PortfolioPolicy.canManage` and `canView` (owner branch) start with `.security(!actor.banned)` (added in #102). A banned owner is denied edit, manage, **and** read of their own portfolio (`GET /me` → 403 `ACCOUNT_BANNED`) |
| `portfolio.md` §Deletion: "ordinary 'delete portfolio' flows soft-delete the Portfolio and leave Testimonial rows intact" | No delete flow exists anywhere (service, controller, route, UI) |
| `portfolios.md` §Visibility: "Users control the visibility of their portfolio" | Nothing writes `Portfolio.visibility`; it stays at the schema default `PUBLIC` |
| `portfolio.md` §Projects: a project "stops appearing everywhere — in the editor and publicly" after membership ends | The dedicated `/projects` endpoint and public query obey this; the editor **aggregate** (`GET /me`, `portfolioEditorInclude.projects`) filters only `deletedAt: null` (`PF-AUD-001`) |
| `technology.md` §Soft Delete: a deleted Technology "behaves as if it does not exist" for everyone except the admin surface | Portfolio's public include and editor include return soft-deleted technologies with no filter (`PF-AUD-005`; the same is true for Projects) |
| `portfolio.md` §Identity: Portfolio URLs are `/u/{username}` | No `/u/[username]` route exists in `src/app` |

### 4.4 Missing (implementation exists, documentation does not describe it)

- The Technologies sub-resource endpoints (`/api/v1/portfolio/technologies*`), `PortfolioAction.MANAGE_TECHNOLOGIES`, and `PortfolioTechnologySummaryDto` in the Portfolio domain doc.
- `resolvePortfolioPublicEligibility`, `AuthorizationCode.FEATURE_DISABLED`, and the rule that the eligibility axis is distinct from stored `visibility` (documented only in code comments and in commit `c956336`).
- The resume upload flow and the fact that a `DOCUMENT` asset cannot be viewed through `secureUrl` (`PF-AUD-002`).
- Why every public denial is a 404 (deliberate non-disclosure) and why the policy runs before the SQL-filtered fetch.
- The three DTO families (editor aggregate, per-section summary DTOs, public DTO) and which is a raw entity.
- A complete endpoint inventory (see Appendix A).
- `PortfolioPermissionResolver` / `PortfolioPermissionsDto` (defined, currently no caller).
- That Better Auth's `updateUser` is the username write path and only `admin` is reserved (`PF-AUD-011`).
- The client-side state model (shared `usePortfolioStore` plus one store per section) is documented; its lack of reset on sign-out is not (`PF-AUD-010`).

### 4.5 Documentation that refers to superseded architecture

- `verify-portfolio-*.ts` headers: standalone-script convention, now superseded by the vitest integration tier (`next/docs/testing`).
- `portfolio.md` §Frontend Editor describes Technologies as a "placeholder"; the section pattern has since matured.

---

## 5. Database Architecture Audit

Schema source: `next/prisma/schema.prisma` (lines 1035–1211 for Portfolio models), migrations `20260804180031_project_portfolio_i2`, `20260907120000_remove_portfolio_unlisted_visibility`, `20260910120000_testimonial_asset_purpose_and_indexes`, `20260910141903_technology_taxonomy_refactor`.

### 5.1 Models

| Model | Key | FKs / cascade | Indexes / unique | Notable |
|---|---|---|---|---|
| `Portfolio` | `id` (cuid) | `userId → user` cascade; `resumeAssetId → asset` set null | `userId @unique`, `@@index(userId)` (redundant with unique), `@@index(visibility)`, `@@index(deletedAt)` | `deletedAt` soft delete; `visibility` default `PUBLIC`; `displayName` required |
| `PortfolioProject` | composite `(portfolioId, projectId)` | both cascade | `@@index(portfolioId, displayOrder)` | `hidden` deprecated (kept for the public query filter); `displayOrder` default 100; has `createdAt/updatedAt` |
| `PortfolioTechnology` | composite `(portfolioId, technologyId)` | both cascade (soft-delete of a Technology never fires it) | none beyond PK | no `createdAt/updatedAt`; `displayOrder` default 0 |
| `PortfolioSettings` | `id`; `portfolioId @unique` | cascade | 1:1 | never created by any code path |
| `PortfolioEducation` / `PortfolioExperience` | `id` | portfolio cascade; logo asset set null | none beyond PK | `createdAt/updatedAt` present; foundation only |
| `PortfolioAchievement` / `PortfolioCertification` | `id` | portfolio cascade; asset set null | none beyond PK | **no `updatedAt`** (inconsistent with Education/Experience); foundation only |
| `Testimonial` (shared) | `id` | `portfolioId → portfolio` cascade; `projectId → project` cascade; `imageAssetId → asset` set null | `@@index` on `projectId`, `portfolioId`, `imageAssetId` | both parents nullable; `displayOrder` default 100; `rating` Int? |
| `Link` (shared) | `id` | `portfolioId → portfolio` cascade | `@@index(portfolioId)` | portfolio links have no management code |

### 5.2 Invariants: where they are actually enforced

| Invariant | Enforced by | Assessment |
|---|---|---|
| One Portfolio per user | **DB** (`userId @unique`) + service pre-check + repository error translation for the race | Sound. Both layers are intentional; backstop is genuinely reachable |
| No duplicate project/technology on a portfolio | **DB** composite primary key; repositories translate `P2002` | Sound |
| A Testimonial has exactly one parent | **Application only** (each service writes only its own FK). No CHECK constraint. The schema has no comment explaining this although `portfolio.md` says it does | Intentional per documentation. Not a defect; do not add a constraint reflexively (a `CHECK ((portfolioId IS NULL) <> (projectId IS NULL))` would be the option if this is ever revisited) |
| `rating` between 1 and 5 | zod only | Acceptable |
| Project relationship valid only while owner is a member | **Query time** (dedicated endpoint + public query); *not* on the editor aggregate | Intentional design (no removal workflow exists) but inconsistently applied; see `PF-AUD-001` |
| Ordering uniqueness | Not enforced; `displayOrder` has no unique constraint | Acceptable. Reorder rewrites 0..n-1; ties are tolerated. Tie-breaks: Projects and Testimonials use `createdAt`; Technologies has none (`PF-AUD-017`) |
| Public visibility (public, not deleted, owner not banned) | Policy + SQL filter (two layers, deliberate) | Sound |
| Deleted content | Portfolio `deletedAt` (policy + SQL); Project `deletedAt` (queries); Technology `deletedAt` (add-time only) | Technology read path gap (`PF-AUD-005`) |
| Asset referenced by a Portfolio slot is not orphan-deleted | Asset lifecycle + `reference-checker` (all Portfolio slots enumerated) + reference-metadata drift-guard test | Sound |

### 5.3 Soft delete, timestamps, orphan risk, transactions

- **Soft delete**: only `Portfolio.deletedAt` (unused in practice, `PF-AUD-013`) and `Technology.deletedAt` (consumed at add time only).
- **Orphan risk**: a `User` hard delete cascades Portfolio → sub-rows; their asset references vanish, leaving assets `ACTIVE` and unreferenced, which the reconciliation sweep (`assets/backend/reconciliation.service.ts`, 24h grace) detaches. This is documented and self-healing.
- **Referential integrity for foundation tables**: `onDelete: SetNull` on every asset FK is consistent with the shared-asset model.
- **Timestamps**: `PortfolioTechnology` has none; `PortfolioAchievement`/`PortfolioCertification` lack `updatedAt`. Cosmetic today; relevant if audit/analytics or "recently updated" sorting is added.
- **Transactions**: see §6.5.

### 5.4 Does the schema match the application architecture?

Yes, with the caveats above. The schema was deliberately shaped so that Portfolio can grow without migration for the foundation sections. The application deliberately relies on service-layer enforcement for the Testimonial XOR and for membership validity; both are documented intent (with one dangling comment reference) and neither is a bug. No database constraint is recommended as a blocker.

---

## 6. Backend Architecture Audit

### 6.1 Controllers (`backend/controller.ts`, 571 lines)

- All handlers use `Route.execute`. Authentication: `SessionService.getStrictActor` in every handler **except** `findMine` and `create`, which hand-roll an actor check and then re-project `{ id, role, banned }`. The redundant re-projection appears three times (`PF-AUD-016`).
- Validation: zod `parse` in every mutating handler except `create` (no body; the old validation is commented out and `createPortfolioSchema` is imported but unused).
- Authorization: not performed in controllers (correct). No Prisma access. No business logic. Comments in the file accurately state this.
- Rate limiting: only `findPublicByUsername`. No authenticated Portfolio route is rate-limited (`PF-AUD-009`).
- Size and shape: one controller class for editor, public and three sub-resources (571 lines). Consistent with Projects; the section comments are clear. Not a maintainability problem yet; the class will grow linearly with each new section (see §19 for the per-section template).
- Hygiene: commented-out code blocks and mixed indentation.

### 6.2 Services

- `PortfolioService` (305 lines): `findPublicByUsername`, `findMine`, `create`, `updateProfile`. Business rules: existence pre-check, entitlement seam, authorizer calls, asset attach. Transactions opened via `prisma.$transaction`, repository constructed with `tx`.
- `PortfolioProjectService`, `PortfolioTestimonialService`, `PortfolioTechnologyService`: each begins every operation with `authorizeManage` (session-derived portfolio → `PortfolioContextResolver.fromData` → `PortfolioAuthorizer.manageX`), returns the full server-ordered list through the mapper. Cross-domain checks are explicit and separate (membership; active technology; asset validity).
- No service accesses Prisma for queries; no service returns entities; no duplicated business logic beyond the deliberate per-section `authorizeManage` helper (three near-identical private methods, one per section; acceptable given each authorizes a different action, and each may diverge).
- `updateProfile` reads the *full public aggregate* (`repository.findByUserIdOrThrow`) merely to obtain `id`, `userId`, `visibility`, `deletedAt`, `resumeAssetId` (`PF-AUD-012`); siblings use the lightweight authorization select.

### 6.3 Repositories

- `PortfolioRepository` (965 lines): three large `include` blocks (`portfolioPublicDetailsInclude`, `portfolioEditorInclude`, plus `buildPortfolioPublicDetailsInclude`) that nearly duplicate each other (the project sub-tree is copied verbatim in editor and public). Business-rule leakage: none. The public query composes `publiclyListableProjectWhere` from the Projects module rather than re-typing it (good).
- Sub-resource repositories are small, composite-key scoped (Projects, Technologies) and accept `PrismaClient | TransactionClient`.
- `PortfolioTestimonialRepository.update` and `delete` are keyed on `id` only (`PF-AUD-020`).
- Unused methods with no application caller: `findById`, `findByUserId`, `findByIdOrThrow`, `findEditorByUserIdOrThrow`, `exists`, `count`, `softDelete`, generic `update` (`PF-AUD-015`).
- Duplicate section header comment and a stray second file header in the middle of the file (formatting).

### 6.4 DTOs

Three families exist:

| Family | Type | Assessment |
|---|---|---|
| Editor aggregate (`PortfolioEditorDto`) | `= PortfolioEditorEntity` (raw Prisma payload) | **Outlier** (`PF-AUD-001`) |
| Summary DTOs (Project, Testimonial, Technology) | hand-mapped interfaces | Good. Explicit field selection, deliberately narrower than the entity, doc comments state what is never exposed |
| Public (`PortfolioPublicDto`) | hand-mapped interface, ISO-string dates | Good; better than the repository convention on dates |

Additional DTO hygiene: `PortfolioSummaryDto = PortfolioSummaryEntity` (marked TODO, unused mapper methods `toSummaryDto(s)`); duplicate `PortfolioPermissionsDto` (`dtos/output/permissions.dto.ts`, missing `canManageTechnologies`, versus `backend/authorization/dto.ts`); `UpdatePortfolioProfileDto` interface duplicating the zod schema; `dtos/output/types.ts` `PortfolioProjectDto` ("for future", references the deprecated `hidden`). Dates are `Date`-typed but arrive as ISO strings in editor and two summary DTOs, while the public and technology DTOs use strings (`PF-AUD-021`).

### 6.5 Transaction audit

| Operation | Writes | Transaction | Verdict |
|---|---|---|---|
| Create portfolio | 1 | yes (`prisma.$transaction`) | Unnecessary (single write) but harmless; unique backstop is the real guard (`INFO-F`) |
| Update profile (with resume) | portfolio row + asset lock + optional detach of previous asset | yes | **Required and correct.** Weakness: `previousResumeAssetId` is read before the transaction (stale under concurrent profile saves); the consequence is bounded because `detachIfUnreferenced` re-counts references under lock and reconciliation sweeps stragglers |
| Add project | max(order) read + insert | yes | Correct for duplicates (PK); the comment "hold a transaction since concurrent appends would collide" overstates it. Under READ COMMITTED two adds can read the same maximum and tie (`PF-AUD-017`); tolerated because reads tie-break on `createdAt` |
| Add technology | max(order) read + insert (eligibility check *outside* the tx) | yes | Same tie caveat, and Technologies has no tie-break; eligibility TOCTOU (technology soft-deleted between check and insert) is benign and unlikely |
| Add / update / remove testimonial | row write + asset lock + detach | yes | **Required and correct.** Update reads `existing` before the tx and re-checks existence inside; stale `imageAssetId` consequence is the same bounded case as above |
| Reorder projects / technologies / testimonials | exact-cover read + N sequential updates | yes | **Required and correct.** Sequential updates are correct for interactive transactions (commented). A concurrent add during a reorder is the only unguarded edge, with negligible impact |
| Set featured / update technology metadata / remove project / remove technology | 1 (`updateMany`/`deleteMany` scoped by composite key) | no | Correct: single statement, atomic |
| Project relationship cleanup on member removal | n/a | seam (`removeForMembershipEnd(tx, …)`) | Correctly designed; unused because no member-removal workflow exists |

**Conclusion:** no multi-write operation lacks a transaction that it needs; transaction boundaries sit in the service layer, matching the repository standard.

### 6.6 Errors

Portfolio has typed errors that extend the shared hierarchy (`NotFoundError`, `ConflictError`, `ForbiddenError`, `ValidationError`) in `errors/errors.ts`, mapped to the right statuses (404/409/403/422), with deliberately indistinguishable messages for "foreign" vs "missing". No thrown strings; no swallowed errors; unique-violation translation is correct. Differences from newer modules: codes are inline literals rather than an `error-code.ts` catalog (Projects, Technologies, Notifications); the mapper throws bare `Error` for invariants (yielding 500 via `ErrorHandler`), which is acceptable for "cannot happen" guards (`PF-AUD-018`).

### 6.7 Validation

zod schemas per endpoint; client and server share the schemas (profile store and testimonial form import them: a positive). Inconsistencies: `resumeAssetId` is `cuid()` while `imageAssetId` is a non-empty string; `technologyId`/`projectId` are non-empty strings only; `create` accepts no body and its schema is dead. Free-text fields have length limits; `phone` is an unconstrained string up to 30 characters; `publicContactEmail` uses `z.email()`.

### 6.8 Mapper

`backend/mapper/mapper.ts` (355 lines) is a single static class: explicit for public and summary DTOs; `toEditorDto` is `return portfolio;` (the leak, `PF-AUD-001`). `toPublicAssetDto` is duplicated with equivalents in Projects and Users mappers (`PF-AUD-002` shows the cost of the duplication: it is the *only* asset mapper that ignores `buildAssetViewUrl`).

---

## 7. Authorization Audit

### 7.1 Current standard

Platform authorization (`PlatformAuthorizer`, `PlatformPermissionSet`, `PlatformAccess` admin bypass) for cross-cutting entitlements; per-resource authorization (`PortfolioPolicy` via the evaluator) for ownership-based decisions. Portfolio has no roles/membership: authority is owner vs. non-owner (`context.ts`), and the action set is `VIEW, CREATE, EDIT, DELETE, MANAGE_PROJECTS, MANAGE_TESTIMONIALS, MANAGE_TECHNOLOGIES`. The evaluator chain orders: banned → admin override → existence → not deleted → ownership. Public read uses an anonymous context (`id: null`), with `ownerBanned` from the freshly fetched owner row.

### 7.2 Per-mutation matrix

| Operation | Actor | Mechanism | Resource scope | Where enforced | Risks |
|---|---|---|---|---|---|
| Create portfolio | any authenticated, non-banned user | `PlatformAuthorizer.can(CREATE_PORTFOLIO)` (entitlement seam) then `PortfolioAuthorizer.create` (banned denied) | the actor themself (`connect: { id: actor.id }`) | Service | Two checks overlap by design (documented). Concurrent create handled by unique backstop |
| Read own | owner | `PortfolioAuthorizer.read` | portfolio looked up by `actor.id` | Service | Banned owner gets 403 on their own data (contradicts docs, §4.3) |
| Update profile | owner | `PortfolioAuthorizer.edit` | `findByUserIdOrThrow(actor.id)` | Service | none cross-user |
| Set / replace / clear resume | owner | `PortfolioAuthorizer.edit` + asset validity (`assertAssetReferenceAllowed`, then locked `prepareAssetAttach`) | own portfolio; **any ACTIVE asset id of the right category** | Service + Assets | By design, asset ownership is never checked (`INFO-B`); asset ids of others are visible in public DTOs, so any authenticated user may reference them |
| Upload for Portfolio purposes | owner | `target-authorization` → `PortfolioAuthorizer.edit` / `MANAGE_TESTIMONIALS` | actor's own portfolio (no client target id trusted) | Assets service | Sound |
| Add / feature project | owner **and** active project member | `MANAGE_PROJECTS` + `findEligibleProject` (exists, not deleted, member row) | own portfolio + trusted membership row | Service | Membership check outside the transaction; benign today |
| Reorder / remove project | owner | `MANAGE_PROJECTS` | composite-key scope (`portfolioId` from session) | Service + Repository | Remove deliberately needs no membership |
| Add technology | owner | `MANAGE_TECHNOLOGIES` + `findActiveById` | own portfolio | Service | Picker is convenience only; server re-validates |
| Update / reorder / remove technology | owner | `MANAGE_TECHNOLOGIES` | composite-key scope | Service + Repository | none |
| Add / update / remove / reorder testimonial | owner | `MANAGE_TESTIMONIALS` | `findByIdForPortfolioOrThrow` scope, then `id`-keyed write (`PF-AUD-020`) | Service (+ repository read scope) | Write keyed on `id` only; safe because always pre-scoped |
| Change visibility | n/a | not implemented | n/a | n/a | `PF-AUD-003` |
| Change username / public URL | authenticated user | Better Auth `update-user`; validator reserves only `admin` | own account | External | `PF-AUD-011` |
| Delete / restore | n/a | not implemented (policy branch exists) | n/a | n/a | `PF-AUD-003`/`013` |
| Links / Education / Experience / Achievements / Certifications / Settings | n/a | not implemented; asset upload authorization already exists for four of them | n/a | n/a | none until built |

### 7.3 Answers to the specific questions

- **Does any mutation rely only on frontend restrictions?** No. The project picker, technology catalog picker and excluded-ids lists are UX conveniences; each server path re-validates (membership, active technology, asset).
- **Does any service trust client-supplied ids for ownership?** No portfolio id is accepted anywhere. `projectId`, `technologyId`, `testimonialId`, `assetId` are accepted as *targets* and are validated against session-derived scope (composite key, membership, active-technology, asset status/category).
- **Is authorization centralised?** Yes: one policy, one authorizer, one resolver. The three per-section `authorizeManage` helpers are thin and identical in shape.
- **Duplicated inconsistently?** Two deliberate duplications: create runs both the platform entitlement and the Portfolio create policy; `findMine`/`updateProfile` build the context from `actor.banned` rather than re-fetching the owner (documented reasoning in `context-resolver.ts`).
- **Admin overrides**: `platformOverride()` sits before the ownership rule inside `canManage`. Because every service resolves the portfolio from `actor.id`, an admin can only ever act on their own portfolio; but any future id-based route would inherit the bypass automatically (`INFO-E`), consistent with the platform convention in `technology.md`.
- **Banned users**: banned actors are denied all owner actions including read; the public path independently denies banned owners (policy + SQL). Session-derived `banned` is read from the current session lookup on every request (no cookie cache is configured in `lib/auth.ts`).
- **Recent alignment**: the `c956336` refactor consolidated Portfolio authorization onto the shared evaluator, added 271 lines of policy tests, and merged a redundant fetch in `target-authorization`. Portfolio authorization is a current-generation implementation.

---

## 8. Frontend Architecture Audit

### 8.1 Structure

Routes: `/portfolio` (empty/create state, then a link into the editor) and `/portfolio/edit/{profile|links|technologies|education|experience|achievements|certifications|projects|testimonials|settings}`. Active tab is derived from the URL. `PortfolioEditorLayout` wraps the section pages. This mirrors the Project editor.

### 8.2 State management

One shared `usePortfolioStore` (portfolio snapshot, loading, error, create, `setPortfolio`), plus per-section stores: `portfolio-profile.store` (dirty tracking, field errors, batched save, client-side zod), and three list-immediate stores (`projects`, `testimonials`, `technologies`) that replace their list wholesale from the server response (pessimistic; no optimistic updates). The pattern is consistent and clear, and it matches `useProjectLinksStore`. It is a good fit for adding more sections.

### 8.3 API interaction

Thin static-class clients (`PortfolioApi`, `PortfolioProjectApi`, `PortfolioTestimonialApi`, `PortfolioTechnologyApi`) over `HttpClient`; they import request types from the shared zod schemas. No stray `fetch`. `PortfolioApi.getPublic` is unused.

### 8.4 Forms, validation, dates

- Profile form uses the server zod schema on the client. After a successful save `savedForm` is set to the *submitted* values rather than the server-normalised response (minor).
- `ProfileEditor` shows "A resume is currently attached" with Remove but no way to view or download it (a consequence of `PF-AUD-002`).
- Dates: `PortfolioEditorDto` is a raw Prisma type, so `Date`-typed fields are strings at runtime (`PF-AUD-021`). Technology `startedUsingAt` is handled as a string.

### 8.4 (continued) UI vs logic

Consistent with Projects: dialogs own transient UI state; stores own persistence. Three components call an API or the auth client directly: `AddTechnologyDialog` (`TechnologyApi.getCatalog()` in an effect; the Project technologies tab does the same), `UsernameDialog` (`authClient.updateUser`), and `TestimonialFormDialog` (zod validation). The `move()` reorder helper is duplicated in the testimonials and technologies sections. None of these is a defect; they are the same trade-offs Projects makes.

### 8.5 Client/server boundary and drift

`dtos/output/details.dto.ts` imports a type from `backend/repository` (which imports Prisma). This is type-only and elided (no `verbatimModuleSyntax`; `isolatedModules: true`), so it does not enter the client bundle today, but it makes the frontend depend on backend query shapes, which is exactly the coupling the DTO rule prohibits. The public DTO and summary DTOs have no such dependency.

### 8.6 Loading and error states

Layout shows skeletons and an error panel; stores expose `isLoading/busy/error`; mutations toast. `getMine` treats 404 as "no portfolio" (empty state). A soft-deleted portfolio would surface as a 403 error panel rather than an empty state (`PF-AUD-013`).

### 8.7 Session-change state (`PF-AUD-010`)

Stores are module-level singletons. `usePortfolioStore.clear()` and every section store's `reset()` exist but have **no caller**. Sign-out (`components/dashboard-sidebar/nav-user.tsx`) calls `authClient.signOut()` then `router.push("/")`, a client-side navigation that does not reload the JS module graph. `PortfolioEditorLayout` fetches only `if (!portfolio)` and `ProfileEditor`'s store only re-initialises when the portfolio *id* changes. In a same-tab account switch (unverified at runtime) the second user could see the first user's cached editor state and, in the worst case, save it over their own portfolio. This is an application-wide pattern (no store in the app is reset on sign-out), not specific to Portfolio.

### 8.8 Dead / unused frontend

`PortfolioRequired` (documented as *the* gating mechanism) has no consumer; `PortfolioTestimonials` (public view component) is unmounted; `PortfolioApi.getPublic` unused; the editor header and `/portfolio` page display a `kizunia.com/u/{username}` URL that does not exist (`PF-AUD-004`).

---

## 9. Public Data & Security Audit

Scope: `GET /api/v1/portfolio/[username]` and `PortfolioPublicDto` / `PortfolioMapper.toPublicDto`.

### 9.1 Visibility enforcement (sound)

Layered: (1) `PortfolioPolicy.canView` on an authorization-shaped row fetched **without** the public filters; (2) SQL pre-filter (`deletedAt null`, `visibility PUBLIC`, owner username match, `banned: { not: true }`) on the data fetch; (3) projects narrowed to `publiclyListableProjectWhere` + `hidden: false` + owner is still a member. Every denial reason (private, banned owner, deleted, ineligible, not found) returns the same 404, so existence of a private portfolio is not disclosed. Covered by unit tests (policy) and one integration test file.

### 9.2 Field-by-field review of the public DTO

| Field(s) | Exposed | Assessment |
|---|---|---|
| `id` (portfolio) | yes | Internal id, unnecessary (username is the public key). Low risk; harmless but not required |
| `displayName`, `headline`, `bio`, `location`, `createdAt` | yes | Presentation data by design |
| `publicContactEmail`, `phone` | yes | Intentionally public and independent of the account email (documented). Publicly scrapable within the 60/min/IP limit; whether phone should be opt-in or hideable is a product decision |
| `user.username`, `user.avatar`, `user.cover` | yes | Required for rendering. The account email, user `id`, `name`, role, ban fields are **not** mapped (verified: `toPublicDto` picks fields explicitly) |
| `settings` (`theme`, `accentColor`, `sectionOrder`, `hiddenSections`) | yes | Presentation only. `hiddenSections` is advertised, but the DTO still ships every section's data (`INFO-A`) |
| `resumeAsset.url` | yes | **Broken link** for DOCUMENT assets (`PF-AUD-002`) |
| `links`, `technologies`, `education`, `experience`, `achievements`, `certifications`, `testimonials` | yes | Owner-authored presentation data. `technologies` includes soft-deleted catalog rows (`PF-AUD-005`) |
| Asset objects (`id`, `url`, `width`, `height`, `format`, `mimeType`) | yes | No `publicId`, `checksum`, `uploadedById`, provider fields. Asset `id` is exposed; because the shared-asset policy allows any authenticated user to reference any active asset id, the id is not a secret (`INFO-B`) |
| `projects[].project` (`id`, `title`, `slug`, `shortDescription`, `logo`, `cover`, `technologies`, `categories`) | yes | Only PUBLIC + PUBLISHED + not deleted + owner-is-member projects. No members, content, status/visibility, badges, competitions, testimonials, links |
| `featured`, `displayOrder` | yes | Presentation |
| Not exposed | `userId`, `deletedAt`, `visibility`, `resumeAssetId`, `user.id/name/email`, `hidden`, raw foreign keys | Correct |

### 9.3 Editor / authenticated DTO

The editor aggregate is the leak surface (`PF-AUD-001`), visible to the owner only: raw `Portfolio` scalars (`userId`, `deletedAt`, `resumeAssetId`), `user.id/name`, raw asset rows, raw technology rows, and complete `Project` rows for portfolio projects with no membership filter (a former member would keep seeing a private project's title, description, visibility, links, technologies, testimonials). This is *latent*: no ProjectMember removal workflow exists yet, so the condition is unreachable in normal operation today, but it is precisely the condition the module's own documentation says never occurs on the editor path.

### 9.4 Other public-surface observations

- **Banned / suspended**: only `User.banned` is honoured. `User.status` (`SUSPENDED`) and `User.visibility` exist in the schema and are never read anywhere; if either is implemented later, the public Portfolio must be updated (`INFO-C`). The public SQL uses `banned: { not: true }` on a nullable column; in SQL `<> true` excludes NULL, so a NULL value fails closed (default is `false`; unverified).
- **Username casing**: the public route does not normalise the username before lookup; Better Auth stores lowercase, so a mixed-case URL may 404 (unverified, `INFO-G`).
- **Testimonials** attribute quotes to named third parties whom Kizunia does not verify (`INFO-D`): a trust/moderation question for the product, not a defect.
- **Caching**: the public resume URL, once fixed, will be a signed ~1 hour URL that must not be persisted or cached by an intermediary (`cloudinary.provider.ts` comment). The public endpoint currently sets no cache headers (none observed), so no conflict exists today.

---

## 10. Asset Architecture Audit

### 10.1 What Portfolio does correctly (aligned with the current Asset lifecycle)

- **Purposes**: `PORTFOLIO_RESUME` (DOCUMENT/PDF, single active), `PORTFOLIO_TESTIMONIAL_IMAGE` (image), plus four foundation purposes (`EDUCATION_LOGO`, `EXPERIENCE_LOGO`, `ACHIEVEMENT_ASSET`, `CERTIFICATION_ASSET`) already defined in `upload-policy.ts`.
- **Upload authorization**: `target-authorization.ts` resolves the actor's own portfolio server-side and checks `PortfolioAuthorizer.edit` (or `MANAGE_TESTIMONIALS`); no client target id is trusted.
- **Attach flow**: fast-fail `assertAssetReferenceAllowed` → in-transaction `prepareAssetAttach` (locked, ordered, re-validated) → FK write → `detachIfUnreferenced(previous)`. The testimonial update additionally treats an unchanged image as a safe no-op.
- **Deletion**: testimonial removal detaches its image in the same transaction; reference counting is authoritative via `AssetReferenceChecker` (all Portfolio slots are enumerated and covered by a drift-guard test).
- **Orphans**: cascade deletion of a Portfolio or User leaves unreferenced ACTIVE assets that the reconciliation sweep detaches after a grace period (documented).

### 10.2 Where Portfolio departs

- **View URL (`PF-AUD-002`)**: `toPublicAssetDto` uses `asset.secureUrl` unconditionally. The Assets module documents (with a "verified against the live cloud" note in `cloudinary.provider.ts`) that `raw` (DOCUMENT) delivery through `secureUrl` returns `401` and that `buildAssetViewUrl` is the supported path; Users (`users/backend/mapper.ts`) and Competition Suggestions (`asset-view.ts`) use it. Portfolio's selects also omit `publicId` and `category`, so the mapper *cannot* compute a view URL without a repository change. Image assets (testimonial images, project logos, avatars) are unaffected.
- **Profile update** always runs `prepareAssetAttach` when `resumeAssetId` is present in the body (the profile form sends it on every save), whereas testimonial update gates on "image changed". Harmless (idempotent), but inconsistent.
- **Foundation sections** have purposes, upload authorization and reference-checker entries with no consumer, which is consistent with the Assets design ("a purpose exists with no consumer wired up yet is caught by the unreferenced sweep").

### 10.3 Public/private behaviour

All Portfolio assets are delivered as public CDN assets. That is appropriate for a public portfolio; for the resume it means the file is only reachable once the (unimplemented) view-URL exchange is added, and then only via a short-lived signed URL.

---

## 11. Logging & Observability Audit

### 11.1 Current logging architecture (audited branch)

There is **no centralized logger** on `main`/`feat/portfolio-v3`. What exists:

| Seam | File | Character |
|---|---|---|
| Rate-limit events | `lib/rate-limit/events.ts` | Typed structured event, swappable sink, `console.info(JSON)`; comment states "Kizunia has no logging framework yet" |
| MCP events | `modules/mcp/observability/events.ts` | Same convention; deliberately emits `userId`/`clientId`, never tokens or payloads |
| Notification events | `modules/notifications/observability/log.ts` | JSON lines on `console`, guarded serialization; states the repo "has no logging abstraction" |
| Global errors | `lib/errors/error-handler.ts` | `console.error(error)` for unhandled errors; no request correlation |

### 11.2 The unmerged logger (`feat/logger`, read via `git show`, not executed)

Adds `lib/logger` (`logger.info/warn/error(event, …)`, `child`, key-based sanitization, error normalization including `AppError` fields and cause chain, `AsyncLocalStorage` request context with `requestId` set in `Route.execute` and `actorId` set by `SessionService`, a swappable sink), migrates the three seams above onto it, and wires competitions, auth/session and internal routes. `ErrorHandler` changes to `logger.error("http.unhandled_error", error)`.

### 11.3 Portfolio

Zero logging: no `console.*`, no events, in any Portfolio file. Nothing sensitive is logged, and errors are neither swallowed nor logged at the module level: unhandled ones reach `ErrorHandler`.

### 11.4 Assessment

Portfolio is not behind on logging; it is consistent with `main`. Once `feat/logger` merges, Portfolio automatically gains request-id-correlated unhandled-error logging through `Route.execute` and `ErrorHandler` with **no Portfolio change required**. Explicit events are worth adding only for decisions that currently leave no trace (for example a denied public read or a project-relationship cleanup once member-removal exists), not as a blanket migration. The logger's own README states not every `console` call should be migrated. Finding: `PF-AUD-008` (INFO-level in practice; not blocking).

---

## 12. Notification/Subscription Architecture Comparison

### 12.1 Notifications: patterns that are relevant to Portfolio

| Pattern | Notifications | Portfolio | Relevant? |
|---|---|---|---|
| Rate limit per route | every route has a `RateLimitPolicyId` | public read only | **Yes**: same request-cost profile as competition/preference writes (`PF-AUD-009`) |
| Error code catalog (`errors/error-code.ts`) | yes | inline literals in `errors/errors.ts` | Marginally (`PF-AUD-018`); only worth doing when touching errors |
| DTO dates as ISO strings with rationale | yes | mixed | **Yes**: adopt for the editor DTO rewrite (`PF-AUD-021`) |
| Slim, explicit DTOs | yes | summaries/public yes; editor aggregate no | **Yes** (`PF-AUD-001`) |
| Repository per aggregate, service orchestration | yes (push subscription extracted to a repository in #100) | yes | Already aligned |
| Cross-module direction rule ("other domains never call in") | enforced | n/a | Portfolio should stay a consumer of Project/Technology/Asset, never call into Notifications |
| Ports/adapters, background jobs, work queue, delivery pipeline, preferences, policy functions | extensive | n/a | **No.** Portfolio has no asynchronous or delivery workload; adopting any of this would be speculative |
| Structured events via one seam | yes | none | Only once a Portfolio decision needs a trace |
| Extensive unit + integration tests | yes | thin | **Yes** (`PF-AUD-014`) |
| Frontend hooks over stores | hooks (`use-notification-inbox`) | stores | Different but both valid; Portfolio matches Projects |

A future Portfolio contact-form intent is already anticipated by the notification docs (`architecture/notifications/principles.md`, `temp/notofication-User-stories.md` US-27). Under the notification direction rule that intent would be *evaluated by Notifications*, not emitted by Portfolio, so no Portfolio work is needed now.

### 12.2 Subscriptions

No code exists. Design docs on `origin/docs/suscriptions-payments` describe the model but are not part of the audited tree. The architecture that matters for Portfolio is already in place and sound: `PlatformAction.CREATE_PORTFOLIO` (creation entitlement), `resolvePortfolioPublicEligibility({ ownerUserId })` (public-display entitlement, runtime-computed, never persisted, distinct from `visibility`, gated only in the non-owner VIEW branch, with an integration test proving losing/regaining eligibility never mutates `visibility`), and `lib/entitlements`. Nothing in Portfolio needs to change to support subscriptions; the risk is the opposite: refactoring these seams would break a design that was built ahead of the feature. No Subscription concept (state machines, provider integration, billing history) should be forced into Portfolio.

---

## 13. Comparison With Current Modules

| Area | Current Portfolio | Current Repository Pattern | Difference | Significance |
|---|---|---|---|---|
| Authorization | Evaluator-based policy, context resolver, authorizer, permission resolver; session-derived portfolio; consolidated in #102 | Same evaluator stack (Projects, Competitions, Notifications admin) | None; Portfolio is current | Aligned. Do not touch |
| Errors | Typed subclasses of shared hierarchy; inline code strings | Same hierarchy; Projects/Technologies/Notifications add `error-code.ts` catalog | Catalog absent | Low. Stylistic; change opportunistically |
| Logging | None | `main`: three ad-hoc seams + `console`; `feat/logger`: centralized (unmerged) | Portfolio has nothing; repo has nothing central yet | Not a Portfolio gap; inherits at boundary once merged |
| DTOs | Public + summaries hand-mapped; editor = raw Prisma entity; dates mixed `Date`/string | Projects README: "never expose Prisma models"; Notifications: ISO strings | Editor aggregate violates the rule the sibling module wrote down | **High** (`PF-AUD-001`) |
| Repositories | Injected `db | tx`; three sub-resource repos; big duplicated includes; several unused methods; one id-only write path | Same injection pattern (Projects) | Include duplication and unused methods; otherwise aligned | Low–medium (`PF-AUD-015`, `020`) |
| Services | Session-derived scope, per-section services, `prisma.$transaction` + `Repository(tx)` | Identical in Projects, Competitions, Notifications | None; one heavy read in `updateProfile` | Aligned; `PF-AUD-012` minor |
| Transactions | Correct where multi-write; asset lifecycle followed; one unnecessary tx | Same | None | Aligned |
| Assets | `prepareAssetAttach` / `detachIfUnreferenced` followed; view URL ignores `buildAssetViewUrl` | Users and Competition Suggestions use `buildAssetViewUrl` for viewing | Portfolio is the only consumer emitting raw `secureUrl` for a DOCUMENT | **High** (`PF-AUD-002`) |
| Frontend state | Shared store + per-section stores; list-immediate pessimistic; no reset on sign-out | Projects uses the same split; no store in the app resets on sign-out | Portfolio matches Projects; the gap is app-wide | Medium (`PF-AUD-010`) |
| Validation | zod per endpoint, shared with client | Same | Minor id-format inconsistencies | Low |
| API contracts | Session-derived, no portfolio id in paths; mutations return full ordered list; all under `/api/v1/portfolio/*` | `/api/v1/...` with `ApiResponse` envelope; Projects returns lists similarly | None; reserved-word/`[username]` collision | Medium (`PF-AUD-011`) |
| Rate limiting | Public read only | Every Competition, Preference, Notification, Asset, Recommendation endpoint; Projects same gap as Portfolio | Portfolio behind newer modules, level with Projects | Medium (`PF-AUD-009`) |
| Module boundary | Empty `index.ts`; other modules import internals (`assets/target-authorization`) | Notifications has a real `index.ts` barrel and a documented boundary; other modules import internals too | Portfolio's README promises a barrel it does not have | Low (`PF-AUD-015`) |
| Tests | Policy unit tests + one integration file; ten legacy `verify-*` scripts | Vitest unit + integration tiers with conventions; Notifications/Assets/Competitions heavily covered | Portfolio's coverage lives mostly in the legacy tier | Medium (`PF-AUD-014`) |

---

## 14. Findings

Classification key: **Type** ∈ {Confirmed bug, Security issue, Data integrity issue, Architectural inconsistency, Maintainability issue, Documentation drift, Missing capability, Product decision, Intentional design difference, Observation}. **Blocking** means blocking *new Portfolio feature development*.

### P0: Critical

None. Rationale: no unauthenticated or cross-user write path; no client-supplied portfolio id; every sub-resource write is scoped by composite key or `portfolioId`; public reads pass a policy and a SQL filter and hand-map an explicit DTO; assets follow the locked lifecycle. Stated explicitly because absence is a finding.

### P1: Important

#### [PF-AUD-001] Editor DTO is a raw Prisma passthrough over an unfiltered, over-fetched aggregate

Type: Architectural inconsistency (with latent data exposure)
Severity: P1
Affected area: `modules/portfolio/dtos/output/details.dto.ts`, `backend/mapper/mapper.ts` (`toEditorDto`), `backend/repository.ts` (`portfolioEditorInclude`), `GET /api/v1/portfolio/me`, `POST /api/v1/portfolio`, `PATCH /api/v1/portfolio/profile`, `frontend/**`

Current behavior:
`PortfolioEditorDto` is a type alias for `PortfolioEditorEntity` (the Prisma payload of `portfolioEditorInclude`), and `toEditorDto` returns its argument unchanged. The include loads the entire tree on every call to `findMine`, `create` and `updateProfile`: user (`id`, `name`, username, avatar/cover), settings, resume, links, technologies (full `Technology` rows), education, experience, achievements, certifications (full `Asset` rows), testimonials, and `projects` with full `Project` rows plus logo, cover, links, technologies, categories, badges, competitions and testimonials. The `projects` clause filters only `project.deletedAt: null`. There is no `ProjectMember` filter.

Evidence:
- `dtos/output/details.dto.ts`: `export type PortfolioEditorDto = PortfolioEditorEntity;`
- `backend/mapper/mapper.ts`: `static toEditorDto(portfolio) { return portfolio; }`
- `backend/repository.ts` `portfolioEditorInclude` (`projects.where` = `{ project: { deletedAt: null } }` only) versus `portfolio-project.repository.ts` `buildManageableWhere` and `buildPortfolioPublicDetailsInclude` (both require the owner to be a member).
- Frontend consumption: only `id`, `displayName`, `headline`, `bio`, `phone`, `publicContactEmail`, `location`, `resumeAssetId`, `user.username` are read (`portfolio-editor-header.tsx`, `portfolio-profile.store.ts`). Projects, testimonials and technologies come from their dedicated endpoints.
- `dtos/output/portfolio-testimonial-summary.dto.ts` itself documents the aggregate as "a raw passthrough for every still-unbuilt section".
- `modules/projects/backend/dto/README.md` rule 6: "DTOs never expose Prisma models."

Why it matters:
It is the only Portfolio contract that is neither explicit nor authorization-aware. It contradicts the documented membership invariant on one read path, couples the frontend to backend query shapes, ships internal fields (raw asset rows including `publicId`/`uploadedById`, `userId`, `deletedAt`, other users' ids inside project rows), and executes a 10+ join query for data no caller uses. Every new Portfolio section that is added to the include automatically widens the wire contract.

Impact:
Latent exposure: a user who is no longer a member of a PRIVATE/DRAFT project still receives that project's metadata through the aggregate until they remove the relationship (unreachable today because no member-removal workflow exists, but that is the documented future). Ongoing cost: performance and accidental contract widening on every section added.

Recommended direction:
Give the editor a hand-mapped, typed DTO limited to what the editor reads (identity/profile scalars, resume asset reference, username); retire the sub-resource collections from the aggregate (they have their own endpoints) or, if any must remain, apply the same membership rules as the dedicated queries. Use ISO strings for dates. Do this before adding further sections so the new sections never enter the aggregate.

Blocking future Portfolio development: YES

#### [PF-AUD-002] Document (resume) URLs are emitted as raw `secureUrl`, which the Assets module documents as undeliverable

Type: Confirmed bug (by the repository's own documented and verified provider behaviour; not runtime-tested here)
Severity: P1
Affected area: `backend/mapper/mapper.ts` (`toPublicAssetDto`, used for `resumeAsset`), `backend/repository.ts` (asset selects), `assets/backend/download-url.ts`, `assets/backend/storage/cloudinary.provider.ts`, `frontend/components/editor/profile/profile-editor.tsx`

Current behavior:
The resume is a `DOCUMENT` asset stored as Cloudinary `raw`. `toPublicAssetDto` returns `url: asset.secureUrl` for every asset, including the resume, in the public DTO. The editor aggregate returns the raw asset row and the UI never shows a link.

Evidence:
`cloudinary.provider.ts` (comment above `buildRawObjectUrl`): "Verified against the live cloud: an untransformed raw delivery URL — the exact `secure_url` Cloudinary itself reports at upload time — answers `401 Unauthorized`… raw delivery is blocked at the account level." `buildViewUrl` exchanges it for an authenticated download URL. `users/backend/mapper.ts` and `competitions/backend/suggestion/asset-view.ts` call `buildAssetViewUrl`. Portfolio selects `{ id, secureUrl, width, height, format, mimeType }` without `publicId` or `category`, so the mapper cannot compute it.

Why it matters:
A resume upload flow exists end to end, yet the result cannot be opened by the owner or by a visitor. Fixing it needs a repository select change, a mapper change, and a caching decision (the exchanged URL is signed and valid for about an hour, "must not be cached or persisted").

Impact:
Public resume is a dead link once a public page or a third-party consumer uses it; the editor has no view/download affordance. Image-category assets are unaffected.

Recommended direction:
Route document assets through the Assets module's view-URL builder in the Portfolio mapper (which requires selecting `publicId` and `category`), keep it out of any cached/persisted payload, and decide whether the resume should be exposed publicly as a signed URL or only through a download action.

Blocking future Portfolio development: YES (for public rendering and the resume feature specifically)

#### [PF-AUD-003] Portfolio visibility and lifecycle cannot be controlled, while the public API is live

Type: Missing capability (with Documentation drift and a Product decision)
Severity: P1
Affected area: `schema.prisma` (`Portfolio.visibility`, `deletedAt`), `backend/authorization/{actions,authorizer,policy}.ts` (`DELETE`), `backend/repository.ts` (`softDelete`), `schemas/update/profile-update.schema.ts`, `portfolio.md`, `portfolios.md`

Current behavior:
`Portfolio.visibility` defaults to `PUBLIC` and no code writes it (`UpdatePortfolioProfileSchema` has no `visibility`; no route, service or UI). `PortfolioAction.DELETE`, `PortfolioAuthorizer.delete` and `PortfolioRepository.softDelete` exist with no caller. The Settings tab is a placeholder.

Evidence:
Repository-wide search for writes to `visibility` finds none outside tests; `softDelete` has zero callers; `portfolios.md` §Visibility ("Users control the visibility of their portfolio"), `portfolio.md` §Deletion ("ordinary delete portfolio flows soft-delete…").

Why it matters:
Any Portfolio whose owner has a username is publicly readable through `GET /api/v1/portfolio/[username]` right now, including the phone number and public contact email if the user entered them, and the owner has no opt-out or deletion. A public page would make this a user-facing privacy issue rather than an API-level one.

Impact:
Privacy default with no control; documented capabilities that do not exist; downstream features (sharing, SEO, sitemap, analytics, indexing) would inherit the uncontrolled default.

Recommended direction:
Decide the default (public-by-default vs private-by-default until the owner publishes) and the delete/restore semantics (see `PF-AUD-013`), then add the write paths on the existing pattern (`PortfolioAction.EDIT`/`DELETE`, already defined in the policy). Update the documentation to match the decision. This is a product decision as much as an engineering one and should be settled before any public page ships.

Blocking future Portfolio development: YES (for the public page, sharing, SEO and indexing work)

### P2: Meaningful

#### [PF-AUD-004] No public Portfolio page, but the UI advertises one

Type: Missing capability
Severity: P2
Affected area: `app/(dashboard)/(portfolio)/portfolio/page.tsx`, `frontend/components/editor/portfolio-editor-header.tsx`, `frontend/api/portfolio-api.ts` (`getPublic`), `frontend/components/view/portfolio-testimonials.tsx`

Current behavior: The editor header and `/portfolio` page render `kizunia.com/u/{username}`. No `/u/[username]` route exists in `src/app`. `PortfolioApi.getPublic` and `PortfolioTestimonials` have no consumers.
Evidence: directory listing of `src/app` (no `u`); grep for `getPublic` / `PortfolioTestimonials`; `portfolio.md` §Portfolio Testimonials openly states "there is currently no public Portfolio page".
Why it matters: The displayed URL is a dead link; owners are told to share it.
Impact: UX/trust issue; not a data or security problem.
Recommended direction: Treat as the next feature, after the blockers in §15. Until then, consider withholding the URL text.
Blocking future Portfolio development: NO (it is the feature)

#### [PF-AUD-005] Soft-deleted Technologies are still returned publicly and in editor lists

Type: Documentation drift / Architectural inconsistency (repository-wide)
Severity: P2
Affected area: `backend/repository.ts` (`portfolioPublicDetailsInclude.technologies`, `portfolioEditorInclude.technologies`), `backend/portfolio-technology.repository.ts` (`findManyByPortfolio`), `docs/architecture/domain/technology.md` §Soft Delete

Current behavior: Reads include `technology: true` with no `deletedAt` filter; the technology summary DTO has no deleted flag, so the editor cannot tell the owner that an entry is stale.
Evidence: repository includes above; `technology.md`: a deleted Technology "behaves as if it does not exist" for everyone except the admin surface. The same is true of `projects/backend/repository.ts`, so this is not Portfolio-specific.
Why it matters: A curated-out technology continues to be presented publicly; the documented restore behaviour is defined in terms of relationships becoming "visible again", which presupposes they were hidden.
Impact: Low (catalog curation is rare); a documentation/behaviour mismatch.
Recommended direction: Decide the rule once at the Technology level (hide on public read, keep in editor with a "no longer available" flag so it can still be removed) and apply it to all three consumers.
Blocking future Portfolio development: NO

#### [PF-AUD-006] Foundation-only models carry maintenance surface without consumers

Type: Observation / Missing capability
Severity: P2
Affected area: `PortfolioSettings`, `PortfolioEducation`, `PortfolioExperience`, `PortfolioAchievement`, `PortfolioCertification`, portfolio `Link`; public DTO fields; `AssetPurpose` values; `reference-checker.ts`, `reference-metadata.ts`, `target-authorization.ts`

Current behavior: Schema, public DTO arrays (always empty), four asset purposes with policies, reference-checker/reporter entries, and upload-authorization cases exist. No service, route, or UI exists. Editor tabs render `PortfolioSectionPlaceholder`.
Why it matters: It is deliberate scaffolding (the Asset lifecycle docs anticipate purposes with no consumer), not a defect, but every schema or asset change must keep it consistent, and the public DTO promises shapes nothing populates.
Impact: Low; makes the "inventory" look larger than what is delivered (§3).
Recommended direction: Keep. Build these sections on the sub-resource template (§19) rather than removing or redesigning the scaffolding.
Blocking future Portfolio development: NO

#### [PF-AUD-007] Documentation drift set

Type: Documentation drift
Severity: P2
Affected area: see §4 (stale, contradictory, missing lists)
Current behavior: `portfolio.md` (v1.1, "Stable") contradicts the banned-editing rule, describes a delete flow and user-controlled visibility that do not exist, calls Technologies a placeholder, and cites a schema comment that is absent; `assets/policies.md` claims no resume flow exists; the module README and `verify-*` headers are stale.
Why it matters: The documents are used as the specification by contributors and AI tooling; contradictory statements produce wrong implementations, and "Stable" invites false confidence.
Impact: Misleading guidance for the very next features.
Recommended direction: Realign after the `PF-AUD-001/002/003` decisions so it is done once (§20 Phase 3).
Blocking future Portfolio development: NO

#### [PF-AUD-008] Portfolio has no logging; the centralized logger is unmerged

Type: Architectural inconsistency (repository-wide, in flight) / Observation
Severity: P2 (INFO in practice)
Affected area: Portfolio module; `lib/errors/error-handler.ts`; branch `feat/logger`
Current behavior: See §11. Unhandled Portfolio errors go through `ErrorHandler` and `console.error` with no request correlation.
Why it matters: Only the premise of the brief; there is nothing Portfolio-specific to fix.
Impact: None on correctness. Debuggability is limited until the logger lands.
Recommended direction: Merge `feat/logger` on its own schedule. Do not add Portfolio-level logging beforehand. Afterward, add explicit events only for decisions that leave no other trace.
Blocking future Portfolio development: NO

#### [PF-AUD-009] Portfolio mutations are not rate-limited

Type: Architectural inconsistency
Severity: P2
Affected area: `backend/controller.ts`, `lib/rate-limit/policies.ts`
Current behavior: Only `PORTFOLIO_READ_PUBLIC` exists. All authenticated Portfolio routes (create, profile, and every sub-resource mutation) are unbounded, including testimonial and technology creation.
Evidence: `policies.ts` (`PORTFOLIO_READ_PUBLIC` only); controllers for Competitions, Preferences, Notifications, Assets, Recommendations enforce policies per route. Projects has the same gap.
Why it matters: A stuck client or abusive account can create unbounded rows of user-authored text and trigger many asset-lock transactions.
Impact: Low today (session-authenticated, local DB only); grows with the number of sections.
Recommended direction: Add local-DB-only write/read policies of the same shape as `COMPETITION_PREFERENCES_READ/WRITE`.
Blocking future Portfolio development: NO

#### [PF-AUD-010] Portfolio client state can bleed across accounts in one tab (unverified at runtime)

Type: Data integrity issue (client-side; application-wide pattern)
Severity: P2
Affected area: `frontend/store/*.ts`, `frontend/components/editor/portfolio-editor-layout.tsx`, `components/dashboard-sidebar/nav-user.tsx`
Current behavior: See §8.7. `clear()`/`reset()` on every store have no caller; sign-out is a client-side navigation.
Why it matters / Impact: In a same-tab sign-out/sign-in as another user, the editor could display and re-save the previous user's cached profile form.
Recommended direction: Reset Portfolio stores on session change (a single place, ideally shared by all modules' stores). Verify at runtime before treating as confirmed.
Blocking future Portfolio development: NO

#### [PF-AUD-011] Reserved words collide with the public username route namespace

Type: Architectural inconsistency
Severity: P2
Affected area: `app/api/v1/portfolio/{me,profile,projects,testimonials,technologies}` beside `[username]`; `lib/auth.ts` (`usernameValidator`); `lib/validation.ts`
Current behavior: Only the literal `admin` is rejected. A user with username `me`, `profile`, `projects`, `testimonials` or `technologies` cannot have their public portfolio resolved through the API (the static segment wins), and `GET /api/v1/portfolio/me` is ambiguous.
Why it matters: The same collision will apply to any future `/u/[username]` page that has static siblings. The username is set through Better Auth, outside Portfolio.
Impact: Low frequency, permanent for the affected user.
Recommended direction: Define one reserved-username list applied at the Better Auth validator and reuse it for route design; settle before the public page ships. Alternatively rename the static segments, but the reserved list also protects future routes.
Blocking future Portfolio development: YES (for the public page; specifically before choosing its route shape)

#### [PF-AUD-012] `updateProfile` loads the full public aggregate only to authorize

Type: Maintainability issue
Severity: P2
Affected area: `backend/service.ts` (`updateProfile`), `backend/repository.ts` (`findByUserIdOrThrow`, `findByUserId`)
Current behavior: `updateProfile` calls `findByUserIdOrThrow`, which returns `PortfolioPublicDetailsEntity` (the widest include), then uses five fields of it. The three sub-resource services use the light `findForAuthorizationByUserIdOrThrow`.
Why it matters: Wasteful and inconsistent within the module; it also means the profile update path reads the public projects sub-tree with no membership filter.
Impact: Performance; readability.
Recommended direction: Use the authorization select plus `resumeAssetId`; fold into the `PF-AUD-001` work.
Blocking future Portfolio development: NO

#### [PF-AUD-013] Portfolio lifecycle state machine is incomplete

Type: Product decision (latent Data integrity issue)
Severity: P2
Affected area: `backend/service.ts` (`ensurePortfolioDoesNotExist`), `backend/repository.ts` (`existsByUserId`), `frontend/store/portfolio.store.ts`
Current behavior: `existsByUserId` counts soft-deleted rows, so a user whose portfolio is soft-deleted gets `409 PORTFOLIO_ALREADY_EXISTS` on create; `GET /me` for that row returns `403 RESOURCE_DELETED` (the frontend shows an error panel, not the empty state). Unreachable today because no path sets `deletedAt`.
Why it matters: When delete is added, the states (delete, recreate, restore, retention) must be defined together, or users get stuck.
Impact: None today; determines the shape of `PF-AUD-003`.
Recommended direction: Decide delete semantics (recreate vs restore vs permanent) with the visibility decision.
Blocking future Portfolio development: YES (folded into `PF-AUD-003`; not independent)

#### [PF-AUD-014] Portfolio test coverage is concentrated in a legacy, manually-run tier

Type: Maintainability issue
Severity: P2
Affected area: `backend/authorization/*.test.ts`, `backend/portfolio-public-visibility.integration.test.ts`, `scripts/verify-portfolio-*.ts`
Current behavior: Vitest coverage: policy unit tests (well-targeted), an eligibility tripwire, one integration file for the public visibility model. Ten `scripts/verify-portfolio-*` / testimonial scripts (about 2.4k lines, run manually with `tsx`, not discovered by `pnpm test`, no CI config in the repo) cover creation, editor ownership, projects authorization/relationship/visibility, public DTO, testimonials authorization and parent isolation. There is no script or test for Technologies at all.
Risky behaviours without automated coverage: technology attach/remove/reorder and deleted-technology handling; `updateProfile` resume lifecycle (attach, replace, clear, detach); `create` race; reorder exact-cover; public-DTO field allow-list (no test guards against a new field leaking); mapper; testimonial image lifecycle; editor aggregate/membership behaviour; rate limiting (none exists).
Why it matters: The scripts are valuable specifications but are invisible to `pnpm test`; the repository's test architecture has moved on (vitest tiers, conventions doc) since they were written.
Impact: Regressions in ownership/visibility rules would not be caught by the standard test run.
Recommended direction: Port the scripts into `*.integration.test.ts` files following `next/docs/testing/conventions.md`, and add the missing behaviours before building further sections.
Blocking future Portfolio development: NO (strongly recommended before public rendering)

### P3 / INFO: Minor and observations

#### [PF-AUD-015] Dead, duplicate and placeholder code

Type: Maintainability issue
Severity: P3
Affected area: many files (see below)
Current behavior:
- Unused: `createPortfolioSchema`, `CreatePortfolioDto`, `PortfolioMapper.toCreateData`; `PortfolioSummaryDto`/`toSummaryDto(s)` (marked TODO); `PortfolioApi.getPublic`; `PortfolioRequired`; `PortfolioPermissionResolver` (no caller); `PlatformAction.VIEW_ALL_PORTFOLIOS`; repository methods `findById`, `findByUserId`, `findByIdOrThrow`, `findEditorByUserIdOrThrow`, `exists`, `count`, `softDelete`, generic `update` (no application caller; scripts may use some).
- Commented-out code: controller `create` validation and `updateProfile` actor check; service `create` (`dto`, `toCreateData`, resume connect); schemas (`UpdatePortfolioProfileDto` variants).
- Duplicates: `PortfolioPermissionsDto` in `dtos/output/permissions.dto.ts` (stale: lacks `canManageTechnologies`) and `backend/authorization/dto.ts`; `UpdatePortfolioProfileDto` interface vs the zod schema; the project sub-tree include copied in editor and public includes; per-section `authorizeManage` helpers.
- Placeholders: `backend/errors.ts`, `backend/mapper.ts`, `backend/permissions.ts`, `constants.ts`, `types/index.ts`, empty `index.ts` barrel, `.gitkeep` directories; `dtos/output/types.ts` `PortfolioProjectDto` referencing the deprecated `hidden`.
- Intentionally kept: `PortfolioProjectService.removeForMembershipEnd` (documented seam for member removal).
Recommended direction: Remove in the same change as the aligned finding (`PF-AUD-001`, `003`), never as a standalone sweep; keep the documented seam.
Blocking future Portfolio development: NO

#### [PF-AUD-016] Controller actor handling and formatting are inconsistent
Type: Architectural inconsistency
Severity: P3
Current behavior: `findMine` and `create` hand-roll actor extraction; the rest use `SessionService.getStrictActor`, which already does that check. `{ id, role, banned }` is re-projected in three places. Mixed indentation.
Evidence: `backend/controller.ts` lines around `findMine`, `create`, `updateProfile`.
Recommended direction: Use `getStrictActor` everywhere; opportunistic.
Blocking: NO

#### [PF-AUD-017] `displayOrder` conventions, tie-breaks and comments are inconsistent
Type: Maintainability issue
Severity: P3
Current behavior: Projects and Technologies start at 0; Testimonials start at 100 (schema defaults 100/0/100/0). Technologies has no tie-break (`PortfolioTechnology` has no `createdAt`; Projects breaks ties by `createdAt`, Testimonials by `createdAt`). Repository comments say holding a transaction prevents two concurrent appends colliding; under the default isolation level two appends can read the same maximum and tie (the primary key still prevents duplicate relationships). Ties self-heal on the next reorder.
Recommended direction: Pick one starting order and a deterministic tie-break (as Project Technologies does with `technologyId`); correct the comments.
Blocking: NO

#### [PF-AUD-018] Error codes are inline literals; invariant guards throw bare `Error`
Type: Architectural inconsistency
Severity: P3
Current behavior: `errors/errors.ts` uses string literals; Projects, Technologies and Notifications use an `error-code.ts` catalog. `toPublicDto` and `toProjectSummaryDto` throw `Error` for "structurally unreachable" states (a 500 if reached).
Recommended direction: Introduce a catalog when errors are next touched; keep the guards.
Blocking: NO

#### [PF-AUD-019] Schema hygiene
Type: Maintainability issue
Severity: P3
Current behavior: `Portfolio @@index([userId])` duplicates the unique index; `PortfolioAchievement`/`PortfolioCertification` lack `updatedAt`; `PortfolioTechnology` has no timestamps; `imageAssetId` validated as a non-empty string vs `resumeAssetId` as `cuid()`; `portfolio.md` cites a `Testimonial` schema comment that does not exist.
Recommended direction: Fix with the next migration touching these tables; do not add the Testimonial XOR or `rating` constraints reflexively (application-level enforcement is documented intent).
Blocking: NO

#### [PF-AUD-020] Testimonial writes are keyed on `id` only
Type: Maintainability issue (defence in depth)
Severity: P3
Current behavior: `PortfolioTestimonialRepository.update/delete` use `where: { id }`, while Projects/Technologies use composite-key `updateMany/deleteMany`. Callers always pre-scope through `findByIdForPortfolioOrThrow` (and the reorder validates exact cover in the same transaction), so this is safe today. `existing` is read before the transaction; the resulting stale `imageAssetId` is bounded by reference-counted detach and reconciliation.
Recommended direction: Scope the repository writes by `portfolioId` when convenient.
Blocking: NO

#### [PF-AUD-021] Date types do not match the wire, and are inconsistent within the module
Type: Maintainability issue
Severity: P3
Current behavior: The editor DTO and the Project/Testimonial summary DTOs declare `Date` but arrive as ISO strings; `PortfolioPublicDto` and `PortfolioTechnologySummaryDto` use strings. Projects share the `Date` convention; the Notifications DTO file documents why ISO strings are correct across a JSON boundary.
Recommended direction: Adopt ISO strings in the rewritten editor DTO and for new DTOs.
Blocking: NO

#### Observations (INFO)

- **INFO-A `hiddenSections` is presentational only.** The public DTO returns every section's data plus the `hiddenSections` list. Today `PortfolioSettings` is never written; once a settings editor exists, users may assume "hidden" means "not published". Needs a product decision (Observation / Product decision).
- **INFO-B Shared-asset policy (Intentional design difference).** `reference-policy.ts` never uses `uploadedBy` as an ownership signal and public DTOs expose asset ids, so any authenticated user may reference any ACTIVE asset id of the right category. Portfolio follows the documented Asset design correctly; changing it would be an Assets-wide decision.
- **INFO-C User status and visibility are unused.** `User.status` (`SUSPENDED`) and `User.visibility` are never read; the public path honours only `banned`. The nullable `banned` filter (`not: true`) fails closed on NULL (unverified).
- **INFO-D Testimonials are unverified third-party attributions.** Documented; a trust/moderation product question, not a bug.
- **INFO-E Admin bypass placement.** `platformOverride()` inside `canManage` is safe because services resolve the portfolio from `actor.id`; any future id-based route inherits the bypass (consistent with the platform convention).
- **INFO-F Create runs two authorization checks and a single-write transaction.** `PlatformAuthorizer` (entitlement seam) then `PortfolioAuthorizer.create`; the transaction is unnecessary but harmless. Both are documented/intentional.
- **INFO-G Username casing.** The public lookup does not normalise the route parameter; Better Auth stores lowercase, so mixed-case URLs may not resolve (unverified).

---

## 15. Must Fix Before More Features

Only genuine blockers. Each is either a correctness/privacy problem on a live surface or a decision that the next feature (the public page and further sections) depends on.

1. **`PF-AUD-001`: Typed, slim editor DTO and query.** Otherwise every new section widens a raw contract, and the membership rule stays violated on the editor path.
2. **`PF-AUD-002`: Document view-URL path.** The resume cannot be viewed today; the fix touches the mapper, selects and caching rules that the public page will reuse.
3. **`PF-AUD-003` + `PF-AUD-013`: Decide the visibility default and delete/restore semantics, then add the write paths.** The public API is live with no owner control; the public page, sharing, SEO and analytics all depend on this.
4. **`PF-AUD-011`: Reserved-username / route namespace decision.** Must precede the choice of route shape for the public page.

## 16. Should Fix Soon

Important, not blocking feature work (they can proceed in parallel).

- `PF-AUD-014`: Port the ten `verify-*` scripts to vitest integration tests and add the missing Technologies, mapper, resume-lifecycle and public-DTO allow-list tests.
- `PF-AUD-009`: Add rate-limit policies for Portfolio reads/writes (same shape as the preference policies).
- `PF-AUD-010`: Reset client stores on session change (design once for the whole app; verify at runtime first).
- `PF-AUD-005`: Decide and apply the deleted-Technology read rule once for Projects, Competitions and Portfolio.
- `PF-AUD-012`: Use the light authorization select in `updateProfile` (folds into `PF-AUD-001`).
- `PF-AUD-007`: Documentation realignment after the Phase 1 decisions.
- `PF-AUD-008`: Adopt the centralized logger when `feat/logger` merges; no Portfolio-specific prerequisite.

## 17. Can Defer

- `PF-AUD-015` to `PF-AUD-021` cleanups (dead code, controller actor handling, order conventions, error-code catalog, schema hygiene, repository scoping, date types), ideally done inside the change that touches each area.
- `INFO-A` … `INFO-G` (revisit when the relevant feature is built: settings editor, suspension, moderation).
- Building the foundation sections (Education, Experience, Achievements, Certifications, Links, Settings): these are features, not stabilization.
- Any new database constraint (Testimonial parent XOR, rating range, unique ordering): not required.

## 18. What NOT To Change

Preserve these; they are sound, tested or deliberately designed, and refactoring them for uniformity would create risk without value.

- **Session-derived portfolio everywhere, no client portfolio id, composite-key scoping** on Projects and Technologies. Cross-portfolio mutation is structurally impossible, not merely rejected.
- **The authorization stack** (`PortfolioContextResolver` / `PortfolioPolicy` / `PortfolioAuthorizer` on the shared evaluator), including the banned-actor rule and the distinct action per section. It was consolidated in #102 and has 271 lines of policy tests.
- **The 404-for-every-public-denial rule** and the two-layer public enforcement (policy first, SQL filter as defence in depth).
- **`resolvePortfolioPublicEligibility` and `PlatformAction.CREATE_PORTFOLIO`**: subscription-ready seams; no other subscription architecture belongs in Portfolio.
- **`publiclyListableProjectWhere` reuse** and the **query-time membership invariant**, plus the unused-but-documented `removeForMembershipEnd(tx, …)` seam for member removal.
- **The per-section service + repository split** (Projects, Testimonials, Technologies) as the template for the remaining sections.
- **List-returning pessimistic mutations and wholesale store replacement** on the frontend.
- **The explicit hand-mapped `PortfolioPublicDto`** and the summary DTOs; only the editor aggregate needs replacing.
- **The Asset attach/detach discipline** (`assertAssetReferenceAllowed` → `prepareAssetAttach` → write → `detachIfUnreferenced`) and the reference-checker/reporter entries for all Portfolio slots.
- **Service → `prisma.$transaction` → `Repository(tx)`**, the repository-wide standard.
- **Application-level enforcement of the Testimonial parent XOR and ordering invariants**, which are documented design.
- **The foundation-only models and their Asset wiring**, since removing them would only have to be undone.
- **Shared zod schemas reused on the client.**

## 19. Recommended Target Portfolio Architecture

The target keeps the repository's standard flow; it changes contracts, not layering.

```
Route handler (src/app/api/v1/portfolio/**)          thin, delegates only
        ↓
PortfolioController                                  Route.execute · getStrictActor · zod parse · rateLimitService.enforce
        ↓
Service (per aggregate / per section)                PortfolioAuthorizer.* (session-derived scope) · cross-domain checks
        ↓                                            (membership, active technology, asset purpose) · prisma.$transaction
Repository(db | tx)                                  data access only, composite-key/portfolio-scoped writes
        ↓
Prisma
```

Where each concern should live:

| Concern | Location |
|---|---|
| Request validation | zod schemas in `schemas/`, parsed in the controller, reused by the frontend |
| Authentication | `SessionService.getStrictActor` in every controller handler (remove the hand-rolled variant) |
| Authorization | Unchanged: `PortfolioPolicy` / `PortfolioAuthorizer` invoked from services; platform entitlement seams stay separate |
| DTO mapping | `PortfolioMapper` in the service layer. Three explicit families: a slim typed **editor** DTO, per-section **summary** DTOs, and the **public** DTO. No Prisma type crosses the service boundary; dates as ISO strings |
| Assets in DTOs | Documents through the Assets view-URL builder (mapper needs `publicId`, `category`); images as today |
| Errors | Typed `AppError` subclasses (add an `error-code.ts` catalog when touched); `ErrorHandler` unchanged |
| Logging | None per service by default; request-id and unhandled errors come from `Route.execute`/`ErrorHandler` once the centralized logger lands; explicit events only where a decision leaves no trace |
| Transactions | Service layer; multi-write and asset operations only; repositories accept `tx`; keep `removeForMembershipEnd(tx, …)` for the future member-removal workflow |
| Rate limiting | Controller-level policies for authenticated reads/writes, local-DB profile |
| New sections | One service + repository + summary DTO + schema + store per section, exactly like Technologies |
| Frontend state | Shared `usePortfolioStore` for the identity/profile snapshot; one list store per section; a session-change reset shared across modules; components render UI, stores own async |
| Public surface | Explicit public DTO; the owner-controlled `visibility` and the eligibility seam as the only two gates; a reserved-username list so the route namespace is unambiguous |
| Module boundary | Populate `index.ts` only if cross-module imports are to be funnelled through it; today Assets imports Portfolio internals, as other modules do |

This is a target, not an implementation: no code is proposed here.

## 20. Stabilization Roadmap

**Phase 1: Critical correctness and privacy**
1. Decide visibility default and delete/restore semantics (`PF-AUD-003`/`013`), then implement the write paths.
2. Replace the editor aggregate with a slim, typed, membership-correct DTO and query (`PF-AUD-001`, `012`).
3. Fix the document view-URL path (`PF-AUD-002`).
4. Define the reserved-username list and public route shape (`PF-AUD-011`).

**Phase 2: Architectural alignment** (independent; may overlap with Phase 1)
5. Rate-limit policies for Portfolio routes (`PF-AUD-009`).
6. Session-change store reset (`PF-AUD-010`, app-wide design).
7. Deleted-Technology read rule across consumers (`PF-AUD-005`).
8. Opportunistic cleanup done inside the touched areas: dead code, controller actor handling, order conventions, error catalog, schema hygiene, date types (`PF-AUD-015`–`021`).
9. Adopt the centralized logger when merged (`PF-AUD-008`).

**Phase 3: Documentation alignment**
10. Rewrite `portfolio.md`, `portfolios.md`, `assets/policies.md`, the module README and script headers against the Phase 1 decisions; add the missing sections listed in §4.4.

**Phase 4: Testing and verification**
11. Port the `verify-*` scripts to vitest integration tests; add Technologies, resume lifecycle, mapper, public-DTO allow-list, editor-DTO/membership, reserved-username and rate-limit tests.

**Phase 5: Feature development readiness**
12. Public Portfolio page (using the public DTO, fixed document URLs, controlled visibility).
13. Education, Experience, Achievements, Certifications and Links on the existing sub-resource template; then Settings (resolving `INFO-A` first).

No time estimates are given.

## 21. Final Assessment

**1. What is actually implemented in Portfolio today?**
Create, read-own, and profile update (including resume upload); complete owner-managed Projects, Testimonials and Technologies; an evaluator-based authorization stack; a layered, hand-mapped public read API; a Profile/Projects/Testimonials/Technologies editor. Not implemented: a public page, visibility change, delete/restore, and the Links/Education/Experience/Achievements/Certifications/Settings sections (schema-only).

**2. What does the documentation incorrectly claim?**
That users control visibility and that delete flows exist; that a banned owner may still edit; that Technologies is a placeholder; that a `Testimonial` schema comment exists; that testimonial ordering matches Projects; that no resume upload flow exists (Assets doc); that the editor never shows a project after membership ends; that a deleted Technology behaves as nonexistent; that a `/u/{username}` page exists as the URL form. Full list in §4.

**3. Which parts of Portfolio are architecturally outdated?**
Only the core editor aggregate (raw entity DTO, over-fetching include, `updateProfile` reading the public aggregate) and, to a lesser degree, the `verify-*` scripts and the inline error-code style. Nothing else is outdated relative to the repository; several parts (sub-resources, authorization) are current-generation.

**4. Which parts are already aligned with the current architecture?**
Authorization (evaluator stack), layering and `$transaction` + `Repository(tx)` use, Asset lifecycle discipline, typed error hierarchy, session-derived scoping, hand-mapped public and summary DTOs, frontend store split (same as Projects), shared zod schemas, subscription/entitlement seams.

**5. What are the highest-risk problems?**
The raw editor DTO with no membership filter (`PF-AUD-001`); the unusable resume URL (`PF-AUD-002`); public-by-default with no visibility control or delete path while the public API is live (`PF-AUD-003`). No P0 exists.

**6. Which problems must be fixed before adding features?**
`PF-AUD-001`, `PF-AUD-002`, `PF-AUD-003` with `PF-AUD-013`, and `PF-AUD-011` (§15).

**7. Which problems can safely wait?**
Rate limits, store reset, deleted-Technology read rule, tests, docs, logger adoption (soon, non-blocking); dead code, conventions, schema hygiene, date types and the INFO items (defer). Two premises in the brief (a merged centralized logger; a subscription implementation) do not exist on the audited branch and need no Portfolio work.

**8. What should the stabilised Portfolio architecture look like?**
The standard Route → Controller → Service → Repository → Prisma flow (§19), with three explicit DTO families (slim editor, section summaries, public), controlled visibility and lifecycle, document assets through the Asset view-URL builder, per-section service/repository/store pieces, and the logger inherited at the `Route`/`ErrorHandler` boundary.

**9. What should we explicitly avoid refactoring?**
The authorization stack, the session-derived/composite-key scoping, the public-read enforcement and 404 rule, the entitlement seams, the Asset lifecycle usage, the sub-resource template, the list-store pattern, the application-level invariants, and the foundation models (§18).

---

## Appendix A. Endpoint Inventory (§16 of the brief)

| Method | Path | Purpose | Auth | Authorization | Request schema | Response | Notes |
|---|---|---|---|---|---|---|---|
| POST | `/api/v1/portfolio` | Create own portfolio | session | `CREATE_PORTFOLIO` + `PortfolioAuthorizer.create` | none | `PortfolioEditorDto` (201) | 409 if exists; hand-rolled actor extraction |
| GET | `/api/v1/portfolio/me` | Read own | session | `PortfolioAuthorizer.read` | none | `PortfolioEditorDto` | 404 when none; raw entity (`PF-AUD-001`); hand-rolled actor |
| PATCH | `/api/v1/portfolio/profile` | Update profile/resume | session | `PortfolioAuthorizer.edit` | `UpdatePortfolioProfileSchema` | `PortfolioEditorDto` | asset lifecycle in tx |
| GET | `/api/v1/portfolio/projects` | List portfolio projects | session | `MANAGE_PROJECTS` | none | `PortfolioProjectSummaryDto[]` | membership + not deleted |
| POST | `/api/v1/portfolio/projects` | Add project | session | `MANAGE_PROJECTS` + membership | `AddPortfolioProjectSchema` | list (201) | 409 duplicate, 403 not member |
| PATCH | `/api/v1/portfolio/projects` | Reorder | session | `MANAGE_PROJECTS` | `ReorderPortfolioProjectsSchema` | list | 422 on mismatch |
| PATCH | `/api/v1/portfolio/projects/[projectId]` | Feature/unfeature | session | `MANAGE_PROJECTS` + membership | `UpdatePortfolioProjectSchema` | list | 404 if not in portfolio |
| DELETE | `/api/v1/portfolio/projects/[projectId]` | Remove | session | `MANAGE_PROJECTS` | none | list | no membership needed |
| GET/POST/PATCH | `/api/v1/portfolio/testimonials` | List / add / reorder | session | `MANAGE_TESTIMONIALS` | Add/Reorder schemas | `PortfolioTestimonialSummaryDto[]` | image via asset id |
| PATCH/DELETE | `/api/v1/portfolio/testimonials/[testimonialId]` | Update / remove | session | `MANAGE_TESTIMONIALS` | Update schema | list | asset detach in tx |
| GET/POST/PATCH | `/api/v1/portfolio/technologies` | List / add / reorder | session | `MANAGE_TECHNOLOGIES` (+ active technology on add) | Add/Reorder schemas | `PortfolioTechnologySummaryDto[]` | undocumented in `portfolio.md` |
| PATCH/DELETE | `/api/v1/portfolio/technologies/[technologyId]` | Update metadata / remove | session | `MANAGE_TECHNOLOGIES` | Update schema | list | remove unconditional |
| GET | `/api/v1/portfolio/[username]` | Public read | none | `PortfolioPolicy.canView` (anonymous) | none | `PortfolioPublicDto` | 60/min/IP; every denial 404; no page consumes it |

Observations: consistent `/api/v1/portfolio/*` naming and versioning; consistent list-returning mutations; no duplicated endpoints; **documented-but-absent**: visibility, delete/restore, settings, links, education, experience, achievements, certifications, public page `/u/{username}`; **present-but-undocumented**: technologies endpoints and `FEATURE_DISABLED` semantics; reserved segment collision with `[username]` (`PF-AUD-011`).

## Appendix B. Method and limits

- Inspected: repository structure, `next/src` module layout, all Portfolio backend/frontend/schema/DTO/error files, Portfolio routes and pages, Prisma models and Portfolio migrations, the shared authorization, error, HTTP, rate-limit and session layers, the Assets module (policies, lifecycle, target authorization, reference checker, storage provider), Technologies and Projects repositories/mappers/visibility, Notifications controller/DTO/error catalog/logging seam, test configs and conventions, all Portfolio-related documentation and the recent Portfolio-affecting commits (`c956336` and history).
- `feat/logger` and `origin/docs/suscriptions-payments` were read through `git show`/`git ls-tree` only. Nothing was checked out, merged, built or run.
- **Unverified (static reading only):** runtime rendering/behaviour of the resume URL (relies on the provider comment in the Assets module), cross-account store bleed (`PF-AUD-010`), mixed-case username lookup (`INFO-G`), NULL handling of the `banned` filter (`INFO-C`), and any performance figure. These are labelled where they appear.
- Not covered: Better Auth internals (only the `username` validator and session shape were read), deployment configuration beyond `vercel.json`, and the content of migrations unrelated to Portfolio.
**