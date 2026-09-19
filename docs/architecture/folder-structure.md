# Folder Structure

> **Status:** Stable
>
> **Version:** 1.0
>
> **Last Updated:** 2026-07-19

---

# Purpose

This document defines the official folder structure for the Kizunia codebase.

The primary goals are:

- Feature-first architecture
- Independent modules
- Clear separation of concerns
- Enterprise maintainability
- Predictable project structure
- Easy onboarding for contributors
- AI-friendly development

Every contributor should follow this structure consistently.

---

# Engineering Principles

The folder structure is based on the following principles.

## Feature First

The project is organized around business features rather than technical layers.

Examples:

- Users
- Projects
- Teams
- Hackathons
- Blogs

Each feature owns its own implementation.

---

## Independent Modules

Every module should be as independent as possible.

Developers should be able to work on different modules simultaneously without frequently modifying the same files.

Each module owns its:

- UI
- Backend
- Store
- Validation
- Business Logic
- Types
- Components

---

## Separation of Concerns

Every layer has exactly one responsibility.

```
Route Handler
      ↓
Controller
      ↓
Service
      ↓
Repository
      ↓
Database
```

Responsibilities should never overlap.

---

## Framework Conventions

Whenever possible, Kizunia follows Next.js conventions instead of replacing them.

Examples:

- App Router
- Route Handlers
- Layouts
- Error Boundaries

---

# Root Structure

```text
src/
│
├── app/
├── modules/
├── components/
├── hooks/
├── stores/
├── lib/
├── config/
├── constants/
├── types/
├── utils/
└── styles/
```

---

# Folder Responsibilities

## app/

The `app` directory contains all Next.js routing and framework-specific files.

Examples:

- App Router
- Route Groups
- Layouts
- Loading UI
- Error Pages
- API Routes

Business logic should never live here.

---

## modules/

The heart of the application.

Every business feature is implemented as an independent module.

Examples:

- users
- projects
- teams
- hackathons
- blogs
- portfolio

Each module owns everything related to its feature.

---

## components/

Contains globally reusable UI components.

Examples:

- shadcn/ui components
- Layout components
- Navigation
- Shared form components

Feature-specific components belong inside their respective module.

---

## hooks/

Contains reusable React hooks.

Only hooks used by multiple modules belong here.

---

## stores/

Contains global Zustand stores.

Examples:

- Theme
- Sidebar
- Global UI

Feature stores remain inside modules.

---

## lib/

Contains wrappers around third-party libraries and infrastructure.

Examples:

- Prisma
- Better Auth
- Axios
- Cloudinary
- Logger
- Email
- MDX

Business logic should never exist inside this folder.

---

## config/

Contains application configuration.

Examples:

- Environment
- Site configuration
- Navigation

---

## constants/

Contains application-wide constants.

Examples:

- Routes
- Limits
- Roles
- Configuration values

---

## types/

Contains globally shared TypeScript types.

Feature-specific types belong inside modules.

---

## utils/

Contains reusable utility functions.

Utilities should always be pure functions.

Business logic should never be placed here.

---

## styles/

Contains global styling resources.

---

# Module Structure

Every module follows exactly the same structure.

Example:

```text
modules/
└── hackathons/
    │
    ├── README.md
    ├── index.ts
    │
    ├── api/
    ├── backend/
    ├── components/
    ├── hooks/
    ├── store/
    ├── schemas/
    ├── types/
    ├── utils/
    │
    ├── constants.ts
    └── metadata.ts
```

---

# Module Responsibilities

Every module owns:

- API Client
- Backend Logic
- UI Components
- Zustand Store
- Validation Schemas
- Feature Types
- Business Utilities
- Feature Constants

Nothing related to a feature should exist outside its module unless it is genuinely shared.

---

# Backend Structure

The backend inside every module follows the same layered architecture.

```text
backend/

controller.ts

service.ts

repository.ts

mapper.ts

permissions.ts

errors.ts
```

---

## Controller

Responsible for:

- Request parsing
- Authentication
- Calling services
- Returning responses

Controllers should never contain business logic.

---

## Service

Responsible for all business rules.

Examples:

- Duplicate detection
- Transactions
- Workflows
- Permission checks
- Business validation

---

## Repository

Responsible only for database access.

Repositories should never contain business rules.

---

## Mapper

Responsible for converting between database models and DTOs.

Prisma models should never be returned directly.

---

## Permissions

Contains feature-specific authorization rules.

---

## Errors

Contains feature-specific error classes.

All feature errors inherit from the global `AppError`.

---

# Request Flow

Every request follows the same architecture.

```text
Browser

↓

React Page

↓

Feature Components

↓

Zustand Store

↓

API Client (Axios)

↓

Next.js Route Handler

↓

Controller

↓

Service

↓

Repository

↓

Prisma

↓

Database
```

This flow should remain consistent across every feature.

---

# Module Independence

Modules should communicate only through their public API.

Every module exposes a single public entry point.

```
index.ts
```

Other modules should never import internal files directly.

Correct:

```ts
import { ProjectService } from "@/modules/projects";
```

Incorrect:

```ts
import { ProjectRepository } from "@/modules/projects/backend/repository";
```

---

# Shared Code

Code should only move outside a module after it has become genuinely reusable.

Avoid creating shared abstractions prematurely.

Shared folders exist to eliminate duplication—not to anticipate it.

---

# Import Rules

Always use path aliases.

Correct:

```ts
import { Button } from "@/components/ui/button";
```

Incorrect:

```ts
import Button from "../../../../components/ui/button";
```

---

# Module Documentation

Every module must contain a `README.md`.

The README should explain:

- Purpose
- Responsibilities
- Folder structure
- Public API
- Dependencies

A new contributor should understand the module within a few minutes.

---

# Design Decisions

## Why Feature-First?

Grouping code by feature keeps related functionality together and allows multiple developers to work independently.

---

## Why Independent Modules?

Independent modules reduce merge conflicts, simplify ownership, and improve long-term maintainability.

---

## Why Layered Backend?

Separating controllers, services, and repositories keeps responsibilities clear and makes testing easier.

---

## Why Global Components?

Only components reused across multiple features should be global.

Everything else remains inside its feature module.

---

## Why Global Stores?

Only application-wide state should be global.

Feature-specific state belongs inside the owning module.

---

## Why Wrap Third-Party Libraries?

Wrapping external libraries behind `lib` isolates implementation details and makes future replacements easier.

---

# Future Expansion

The folder structure should evolve only when it improves maintainability.

New folders should not be introduced unless they solve a clear architectural problem.

Consistency is preferred over unnecessary abstraction.

---

# Guiding Principle

> Organize the codebase around business features, not technical layers.

Every architectural decision should improve modularity, readability, maintainability, and contributor experience while keeping the project approachable for both human developers and AI-assisted development.