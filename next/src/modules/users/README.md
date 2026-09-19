# Users Module

## Purpose

Manages all user-related functionality including profiles, settings, and user data.

## Responsibilities

- User profile management
- User settings and preferences
- User data CRUD operations
- User-related business logic

## Folder Structure

```
users/
├── README.md           # This file
├── index.ts            # Public API — only import from here
├── api/                # API client functions (frontend → backend)
├── backend/
│   ├── controller.ts   # Request parsing, auth, response
│   ├── service.ts      # Business logic
│   ├── repository.ts   # Database access (Prisma)
│   ├── mapper.ts       # DB model ↔ DTO conversion
│   ├── permissions.ts  # Authorization rules
│   └── errors.ts       # Feature-specific errors
├── components/         # Feature-specific UI components
├── hooks/              # Feature-specific React hooks
├── store/              # Zustand store for user state
├── schemas/            # Zod validation schemas
├── types/              # Feature-specific TypeScript types
├── utils/              # Feature-specific utilities
├── constants.ts        # Feature constants
└── metadata.ts         # Feature metadata
```

## Public API

```ts
import { ... } from "@/modules/users";
```

Other modules should **never** import internal files directly.

## Dependencies

- `@/lib/prisma` — Database access
- `@/lib/auth` — Authentication
