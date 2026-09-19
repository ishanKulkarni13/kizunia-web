# Portfolio Module

## Purpose

User portfolio and showcase management.

## Folder Structure

```
portfolio/
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
import { ... } from "@/modules/portfolio";
```

Other modules should **never** import internal files directly.
