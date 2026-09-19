# Authorization Implementation Guide

> **Status:** Stable
>
> **Version:** 1.0
>
> **Audience:**
>
> - Backend Developers
> - Frontend Developers
> - Contributors
>
> **Last Updated:** 2026-07-19
>
> **Related Documents:**
>
> - `README.md`
> - `foundation.md`
> - `architecture.md`
> - `conventions.md`

---

# Purpose

This document explains how authorization should be implemented throughout the Kizunia codebase.

Unlike the architecture documentation, this guide focuses on practical implementation.

After reading this document, contributors should be able to:

- Add a new Resource
- Add a new Action
- Add a new Permission Set
- Create a Context Resolver
- Create an Authorizer
- Protect API Routes
- Protect Server Actions
- Render frontend UI correctly

---

# Development Workflow

Whenever a new protected Resource is introduced, the following implementation workflow should be followed.

```

Design Resource

↓

Define Actions

↓

Define Roles

↓

Define Permission Sets

↓

Create Context

↓

Create Context Resolver

↓

Create Authorizer

↓

Integrate Controller

↓

Integrate Frontend

↓

Write Tests

```

Every protected resource should follow exactly the same workflow.

---

# Step 1 — Define the Resource

Every authorization implementation begins with a Resource.

Examples include:

- Project
- Team
- Blog
- Hackathon
- Portfolio

Every Resource owns its own authorization system.

Never reuse another Resource's Authorizer.

---

# Step 2 — Define Actions

Actions represent business operations.

Example:

```
Project

↓

View

Edit

Delete

Archive

Transfer Ownership

Manage Members
```

Actions should remain stable.

Adding new Roles should rarely require changing Actions.

---

# Step 3 — Define Roles

Each Resource defines its own Roles.

Example:

```
Owner

Maintainer

Contributor
```

Resource Roles should remain completely independent from Platform Roles.

---

# Step 4 — Define Permission Sets

Permission Sets define what every Role may perform.

Example:

```
Owner

↓

Everything
```

```
Maintainer

↓

Edit

Manage Members

Manage Media
```

Permission Sets should be declared inside the codebase.

They should never be modified dynamically.

---

# Step 5 — Create Context

Design the Context required for authorization.

Typical information includes:

- Actor
- Resource
- Membership
- Platform Role
- Ownership
- Verification

The Context should contain only authorization-related information.

```

Continue after this:

---

````md
# Step 6 — Implement the Context Resolver

Every protected resource should expose one Context Resolver.

Responsibilities include:

- Loading the Resource
- Loading memberships
- Resolving platform roles
- Resolving ownership
- Constructing the Context

The resolver should perform all required data loading before authorization begins.

Authorizers should never communicate with the database.

---

# Step 7 — Implement the Authorizer

Every Resource owns exactly one Authorizer.

Typical methods include:

- view()
- edit()
- delete()
- archive()
- restore()
- transferOwnership()
- abilities()

Every method accepts a Context and returns an Authorization Decision.

Authorizers should remain pure.

---

# Step 8 — Protect Controllers

Controllers should authorize requests before invoking business logic.

Example flow:

```

Controller

↓

Context Resolver

↓

Authorizer

↓

Service

↓

Repository

```

Controllers should never contain inline role checks.

---

# Step 9 — Render Frontend UI

Frontend components should render using Abilities rather than Roles.

Good:

```tsx
if (abilities.edit.allowed)
```

Avoid:

```tsx
if (member.role === "OWNER")
```

Components should not understand authorization rules.

They should consume authorization results.

---

# Step 10 — Write Tests

Every new Resource should include tests for:

## Context Resolver

- Builds the correct Context
- Resolves ownership
- Resolves membership

## Authorizer

- Owner permissions
- Maintainer permissions
- Contributor permissions
- Platform Admin overrides
- Invalid Context

## Integration

- Controller
- Authorizer
- Service
- Repository

working together correctly.

---

# Common Mistakes

Avoid the following patterns.

❌ Role checks inside Controllers

❌ Role checks inside Services

❌ Database queries inside Authorizers

❌ Duplicating authorization logic

❌ Returning booleans

❌ Frontend depending on Roles

❌ Dynamic Permission Sets

---

# Implementation Checklist

Before merging a Pull Request involving authorization, verify the following.

- Resource created
- Actions defined
- Roles defined
- Permission Sets defined
- Context implemented
- Context Resolver implemented
- Authorizer implemented
- Authorization Decisions returned
- Controllers protected
- Frontend uses Abilities
- Tests added
- Documentation updated

---

# Summary

Every protected feature within Kizunia should follow exactly the same implementation workflow.

Authorization should always be:

- Centralized
- Predictable
- Pure
- Testable
- Resource-oriented

Following this guide ensures every new Resource integrates naturally into the existing authorization architecture without introducing duplicated logic or inconsistent permission handling.