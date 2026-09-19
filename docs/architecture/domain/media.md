# Media (Superseded)

> **Status:** Superseded by [`docs/architecture/domain/assets/overview.md`](./assets/overview.md)
>
> **Version:** 1.0 (final)
>
> **Last Updated:** 2026-09-05

---

## This Document Has Been Superseded

This document originally described an image-only "Media" concept: uploaded visual assets, stored via Cloudinary, with videos intentionally excluded in favor of external links.

That direction has changed. Kizunia is moving from an image-only Media concept to a broader **Asset** concept that can represent images, videos, and documents (e.g. a portfolio resume PDF) under one lifecycle, while keeping the storage provider (Cloudinary today) an infrastructure detail rather than a domain assumption.

The reasons this document is retired rather than edited in place:

- It states "Kizunia intentionally limits uploaded media to images" and "videos are not uploaded directly to Kizunia." The target architecture explicitly allows for a `VIDEO` asset category (see [`assets/overview.md`](./assets/overview.md#asset-categories)) — this is a direct conflict, not a wording difference.
- It has no lifecycle concept at all — no equivalent of the four `ACTIVE` / `DETACHED` / `DELETING` / `DELETED` states now defined in [`assets/lifecycle.md`](./assets/lifecycle.md) (that document explicitly notes `UPLOADING` is *not* one of them — an Asset row is only ever created once upload and finalization have already succeeded).
- Its `url`/`type`/`alt`/`caption` field list does not reflect the actual `Asset` Prisma model (`publicId`, `secureUrl`, `provider`, `format`, `mimeType`, `width`, `height`, `bytes`, `checksum`, `originalFilename`) or the target's domain/provider metadata split (see [`assets/storage.md`](./assets/storage.md)).

**Read the current architecture here instead:**

- [`assets/overview.md`](./assets/overview.md) — what an Asset is, categories, metadata, relationships
- [`assets/lifecycle.md`](./assets/lifecycle.md) — the four-state lifecycle
- [`assets/upload.md`](./assets/upload.md) — upload flow, current vs. target
- [`assets/policies.md`](./assets/policies.md) — upload purposes and policy-driven restrictions
- [`assets/storage.md`](./assets/storage.md) — the storage-provider abstraction
- [`assets/security.md`](./assets/security.md) — authorization, rate limiting, validation, orphan cleanup

The related architecture decision records [`docs/architecture/decisions/media.md`](../decisions/media.md) and [`docs/architecture/decisions/storage.md`](../decisions/storage.md) are similarly superseded in the parts that conflict with this direction — see the notices at the top of each.
