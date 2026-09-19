# Assets Module

## Purpose

Owns the Asset domain: a platform-owned uploaded resource and its lifecycle
(`ACTIVE` -> `DETACHED` -> `DELETING` -> `DELETED`), the `UploadIntent`
application layer that authorizes and finalizes uploads, upload policies,
and the storage-provider abstraction that keeps Cloudinary out of every
other layer.

See `docs/architecture/domain/assets/` for the full architecture.

## Folder Structure

```
assets/
├── README.md
├── index.ts
├── backend/
│   ├── controller.ts              upload-intent + finalize endpoints
│   ├── service.ts                 AssetService — finalize/detach
│   ├── upload-intent.service.ts   UploadIntentService — the Asset Application Layer
│   ├── upload-intent.repository.ts
│   ├── repository.ts              AssetRepository (DB-only)
│   ├── reference-checker.ts       counts references across every explicit Asset relation
│   ├── reference-policy.ts        assertAssetReferenceAllowed (Asset-side attach check)
│   ├── target-authorization.ts    dispatches to each domain's own authorizer
│   ├── reconciliation.service.ts  abandoned-intent / detached / stale-deleting sweeps
│   ├── policies/                  code-defined UploadPolicy per AssetPurpose
│   ├── storage/                   StorageProvider contract + Cloudinary adapter
│   └── errors/
├── schemas/                        Zod input schemas
├── dto/                             AssetDTO
├── mapper/
└── frontend/
    ├── api/                        AssetApi (HttpClient wrapper)
    ├── hooks/                      useAssetUpload — shared upload infrastructure
    ├── components/                 DocumentUploader
    └── types.ts
```

## Public API

```ts
import { assetService, assertAssetReferenceAllowed } from "@/modules/assets";
```

## What This Module Is NOT Responsible For

- Deciding who may edit a specific Project/Competition/Portfolio — that
  authorization lives in each domain module and is only *dispatched to* from
  here (`target-authorization.ts`).
- Rendering upload UI — see `ReusableImageUploader`
  (`components/cloudinary/imageUploader/`) and `DocumentUploader`
  (`frontend/components/`).
- Talking to Cloudinary directly outside of `backend/storage/cloudinary.provider.ts`.
