# Blogs Module

## Purpose

Blog post creation, publishing, and management.

## Folder Structure

```
blogs/
├── README.md
├── index.ts
├── api/
├── backend/
│   ├── controller.ts
│   ├── service.ts
│   ├── repository.ts
│   ├── mapper.ts
│   ├── permissions.ts
│   └── errors.ts
├── components/
├── hooks/
├── store/
├── schemas/
├── types/
├── utils/
├── constants.ts
└── metadata.ts
```

## Public API

```ts
import { ... } from "@/modules/blogs";
```

Other modules should **never** import internal files directly.
