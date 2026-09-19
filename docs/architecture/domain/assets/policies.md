# Asset — Upload Policies

> **Status:** Draft (Target Architecture)
>
> **Version:** 1.0
>
> **Last Updated:** 2026-09-05

---

# Purpose

An **upload policy** answers the question the Asset Application Layer needs answered before it authorizes anything: *for this declared upload purpose, what is actually allowed?*

> **The policy is the authority. The frontend's `accept` attribute is a convenience, never a security boundary.**

**Current Implementation:** No policy concept exists in the repository today. Validation is limited to `CreateAssetSchema` (Zod), which checks the *shape* of client-reported metadata (e.g. `bytes` is a non-negative integer, `secureUrl` is a URL) but never checks it against any rule for what a given upload purpose should allow. The `accept` prop on `ReusableImageUploader` (default `"image/*"`) is the only "restriction" that exists anywhere in the current flow, and it is enforced only by the browser's file picker / `react-dropzone` — nothing stops a client from bypassing it and submitting arbitrary metadata directly to the backend, because the backend never re-checks it (see [`upload.md`](./upload.md#current-implementation)).

---

# Upload Purpose

Every upload is for a **purpose** — a named reason the upload exists, tied to a specific use in the product. The Asset Application Layer resolves a policy from the declared purpose before authorizing anything.

Derived from the entity relations already present in the Prisma schema (see [`overview.md`](./overview.md#relationships-to-domain-entities)), the natural set of purposes includes — as **examples, not a final exhaustive list**:

- `USER_AVATAR`
- `USER_COVER`
- `PROJECT_LOGO`
- `PROJECT_COVER`
- `COMPETITION_LOGO`
- `COMPETITION_BANNER`
- `COMPETITION_COVER`
- `COMPETITION_SUGGESTION_GALLERY`
- `PORTFOLIO_RESUME`
- `PORTFOLIO_EDUCATION_LOGO`
- `PORTFOLIO_EXPERIENCE_LOGO`
- `PORTFOLIO_ACHIEVEMENT_ASSET`
- `PORTFOLIO_CERTIFICATION_ASSET`
- `PROJECT_TESTIMONIAL_IMAGE`
- `PORTFOLIO_TESTIMONIAL_IMAGE`
- `BADGE_ICON`

`TESTIMONIAL_IMAGE` (singular, shared across both domains) is
**deprecated**: it predates per-instance authorization for testimonial
images and is superseded by the two purposes above, split by owning domain
like every other purpose here (`PROJECT_LOGO` vs. `PORTFOLIO_RESUME`). The
enum value is kept — Postgres enum values cannot be safely dropped — but no
application code issues it anymore.

New relations that reference `Asset` in the future should each define their own purpose the same way, rather than being folded into an existing one just because the file type happens to match.

---

# What a Policy Defines

Each policy may define, as applicable:

- Allowed asset **category** (`IMAGE` / `VIDEO` / `DOCUMENT` — see [`overview.md`](./overview.md#asset-categories))
- Allowed **MIME types**
- Allowed **extensions**
- **Maximum file size**
- **Maximum dimensions** (for images/video)
- **Maximum duration** (for video)
- **Maximum number of files** (relevant for gallery-style purposes like `COMPETITION_SUGGESTION_GALLERY`)
- Whether **only one active asset is allowed** at a time for this purpose/entity (true for a logo or avatar; not applicable to a gallery)
- Required **authorization** (who may perform this upload — delegated to Kizunia's existing authorization system, not reimplemented per policy)
- Any additional **provider/storage constraints**

None of these numeric values (exact size limits, dimension limits, count limits) are decided by this document. Where a concrete example is useful below, it is marked as illustrative, not as a specification.

---

# Worked Example: `PORTFOLIO_RESUME`

The Prisma schema already has `Portfolio.resumeAsset` (an optional `Asset` relation). This is the clearest existing example of why Asset cannot remain image-only, and a good illustration of what a policy would look like:

- Category: `DOCUMENT`
- MIME type: `application/pdf` (product requirement, current scope — DOCX is not required for the initial implementation unless a future product decision says otherwise)
- Count: one active asset per portfolio (a new resume upload replaces, rather than adds to, the existing one)
- Size limit: **Decision: TBD** — not established anywhere in the repository or product requirements today

This is a policy *shape*, not a claim that this policy is implemented — it is not; there is currently no resume upload flow in the codebase at all (`resumeAssetId` exists on the DTO/schema layer in `modules/portfolio`, but the actual upload path is not wired up — see the commented-out `resumeAsset` block in `modules/portfolio/backend/service.ts`).

---

# Frontend vs. Backend Enforcement

| Layer | What it does | Trust level |
|---|---|---|
| Frontend `accept` attribute, client-side size checks | Improves UX — avoids letting a user pick an obviously-wrong file and wait through an upload only to have it rejected | UX only, never trusted |
| Upload policy, evaluated server-side before authorization is granted | The actual security boundary — determines whether an upload is authorized at all | Trusted |
| Provider result validation | Confirms what the provider actually did matches what was authorized | Trusted |

See [`security.md`](./security.md) and [`upload.md`](./upload.md) for how these fit into the overall flow. A policy that exists only as a client-side `accept` string enforces nothing — this is precisely the current state for every upload purpose in the repository today.

---

# Guiding Principle

> **A file type list in the UI is a hint to the user. A policy evaluated on the backend is the rule.**
