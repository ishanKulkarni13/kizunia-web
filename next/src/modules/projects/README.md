# Projects Module

## Purpose

Project creation, management, and collaboration.

## Folder Structure

```
projects/
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
import { ... } from "@/modules/projects";
```

Other modules should **never** import internal files directly.
