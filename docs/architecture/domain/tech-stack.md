# Tech Stack

> **Status:** Superseded
>
> **Version:** 1.1
>
> **Last Updated:** 2026-09-10

---

This document has been superseded by [`technology.md`](./technology.md), the canonical reference for the Technology domain.

What changed from the design described in the earlier version of this document:

- The field is `type` (a locked `TechnologyType` enum: `LANGUAGE`/`FRAMEWORK`/`LIBRARY`/`DATABASE`/`RUNTIME`/`TOOL`/`PLATFORM`/`SERVICE`/`OTHER`), not a free-form `category`.
- Icons are Asset-backed (`iconAssetId`), not a plain URL field.
- Technology supports soft delete (`deletedAt`) with restore, not just create/read/update.
- Technology is **no longer referenced by Users directly** — `UserTechnology` has been removed. `PortfolioTechnology` is the presentation-oriented replacement for "technologies a builder is familiar with."
- Blog referencing Technology remains future work, unimplemented — see `blog.md` and the "Blogs" section of `technology.md`.

See [`technology.md`](./technology.md) for the current model, consumer semantics (Project/Competition/Portfolio), the global-vs-consumer authorization split, and ordering rules.
