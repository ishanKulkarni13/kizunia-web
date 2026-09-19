# Authorization Conventions

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
> - `implementation.md`

---

# Purpose

This document defines the conventions that every contributor must follow when working with Kizunia's authorization system.

Unlike the architecture documentation, this document is normative.

Every rule in this document should be considered mandatory unless an architectural decision explicitly changes it.

The goal is to keep authorization predictable, maintainable, and consistent across the entire platform.

---

# Core Principles

Every authorization-related implementation should follow these principles.

- Authorization is centralized.
- Authorization is deterministic.
- Authorization is resource-oriented.
- Authorization is framework-independent.
- Authorization is shared between frontend and backend.
- Authorization is evaluated before business logic.
- Authorization is never duplicated.

---

# Naming Conventions

## Authorizers

Every resource owns exactly one Authorizer.

Good:

```ts
ProjectAuthorizer
TeamAuthorizer
BlogAuthorizer
HackathonAuthorizer
PortfolioAuthorizer
```

Avoid:

```ts
PermissionService
ProjectPermissions
ProjectGuard
ProjectPolicyManager
```

---

## Context

Every resource owns exactly one Context.

Good:

```ts
ProjectContext
TeamContext
BlogContext
```

Avoid:

```ts
ProjectAuthorizationData
ProjectPayload
ProjectInfo
```

---

## Context Resolvers

Every Context should be created by a dedicated Context Resolver.

Good:

```ts
ProjectContextResolver
TeamContextResolver
BlogContextResolver
```

---

## Actions

Actions should always be verbs.

Good:

```ts
Edit
Delete
Archive
Publish
TransferOwnership
ManageMembers
```

Avoid:

```ts
ProjectEditor
OwnerPermission
EditPermission
```

Actions represent operations.

They do not represent permissions.

---

## Permission Sets

Permission Sets should be named after the resource.

Good:

```ts
ProjectPermissionSet
TeamPermissionSet
BlogPermissionSet
```

Avoid:

```ts
Permissions
RolePermissions
AccessControl
```

---

# Controller Rules

Controllers should remain extremely small.

Controllers may:

- Authenticate the request
- Validate requests
- Map DTOs
- Invoke Services
- Return responses

Controllers must never:

- Query the database
- Execute business logic
- Perform inline role checks
- Resolve Context
- Invoke Authorizers

Context Resolution and Authorization happen inside the Service, not the
Controller — see "Service Rules" below.

Bad:

```ts
if(member.role==="OWNER")
```

Good (inside the Service, not the Controller):

```ts
authorize.project.edit(context)
```

---

# Context Resolver Rules

Context Resolvers are responsible only for constructing Context objects.

Resolvers may:

- Query repositories
- Resolve memberships
- Resolve ownership
- Resolve platform roles

Resolvers must never:

- Execute business logic
- Modify resources
- Return HTTP responses
- Perform authorization

---

# Authorizer Rules

Authorizers are pure.

Authorizers may:

- Evaluate Context
- Produce Authorization Decisions
- Generate Abilities

Authorizers must never:

- Query databases
- Call repositories
- Call Better Auth
- Send notifications
- Execute business logic
- Modify state

The same Context must always produce the same Authorization Decision.

---

# Service Rules

Services execute business logic — and are also responsible for resolving
Context and invoking the Authorizer before that logic runs.

Services may:

- Resolve Context (via a Context Resolver)
- Invoke Authorizers
- Update resources
- Publish blogs
- Create projects
- Execute workflows

Services must never:

- Check roles inline (`member.role === "OWNER"`)
- Generate Abilities themselves (that's the Authorizer's/Permission
  Resolver's job — Services only call them)
- Run business logic before authorization has been asserted

Every mutating Service method follows the same shape:

```ts
async updateSomething({ id, actor, dto }) {
  const resource = await this.getResourceOrThrow({ id });

  const context = ResourceContextResolver.fromData({ actor, resource, ... });

  ResourceAuthorizer.edit(context); // throws if denied

  // business logic only below this line
}
```

---

# Repository Rules

Repositories are responsible only for persistence.

Repositories may:

- Read data
- Write data
- Execute transactions

Repositories must never:

- Execute business logic
- Evaluate authorization
- Return DTOs intended for presentation

---

# Frontend Rules

The frontend consumes authorization.

It never implements authorization.

Good:

```tsx
abilities.edit.allowed
```

Avoid:

```tsx
member.role==="OWNER"
```

Avoid:

```tsx
platformRole==="ADMIN"
```

Frontend components should not understand authorization rules.

They should only understand Authorization Decisions and Abilities.

---

# Backend Rules

Every mutation must perform authorization.

Never assume that because the frontend hid a button, the backend request is safe.

The backend is the final authority.

---

# Authorization Decisions

Never return:

```ts
boolean
```

Always return:

```ts
AuthorizationDecision
```

Every authorization result should explain why an action was denied whenever possible.

---

# Abilities

Abilities are intended only for presentation.

They should never be persisted.

They should never become part of the database schema.

Abilities should always be generated from the current Context.

---

# Permission Sets

Permission Sets should remain static.

Permission Sets must:

- Live inside the codebase
- Be reviewed through Pull Requests
- Be version controlled

Permission Sets should never be modified directly from the database.

---

# Testing Rules

Every Authorizer should have unit tests.

Every Context Resolver should have unit tests.

Every protected endpoint should have integration tests.

Authorization should be one of the most heavily tested parts of the application.

---

# Documentation Rules

Whenever authorization changes:

- Update the architecture if required.
- Update the implementation guide if required.
- Update Permission Sets.
- Update examples.
- Update tests.

Documentation should evolve together with the implementation.

---

# Pull Request Checklist

Before merging an authorization-related Pull Request, verify the following.

- [ ] Architecture still respected
- [ ] No inline role checks
- [ ] No authorization inside Controllers
- [ ] No authorization inside Repositories
- [ ] Service resolves Context and authorizes before business logic runs
- [ ] Authorizer remains pure
- [ ] Context Resolver added if required
- [ ] AuthorizationDecision returned
- [ ] Frontend uses Abilities
- [ ] Unit tests added
- [ ] Integration tests added
- [ ] Documentation updated

---

# Anti-Patterns

The following patterns should never appear in the codebase.

❌

```ts
if(member.role==="OWNER")
```

---

❌

```ts
if(platformRole==="ADMIN")
```

---

❌

```ts
await prisma.project.findUnique(...)
```

inside an Authorizer.

---

❌

```ts
authorize(...)
```

inside a Repository.

---

❌

Business logic mixed with authorization.

---

❌

Returning boolean values from Authorizers.

---

❌

Duplicating authorization logic between frontend and backend.

---

# Code Review Guidelines

When reviewing authorization-related Pull Requests, reviewers should ask:

- Is authorization centralized?
- Is the correct Authorizer being used?
- Is the Context complete?
- Is the Authorizer pure?
- Are business rules separated from authorization?
- Are Permission Sets still correct?
- Will this architecture scale?
- Does the frontend consume Abilities instead of Roles?
- Are Authorization Decisions returned consistently?

If the answer to any of these questions is "No", the Pull Request should be revised before merging.

---

# Final Philosophy

Authorization is infrastructure.

It is not merely a collection of permission checks.

A contributor should never ask:

> "Where should I check permissions?"

The answer should always be obvious.

Every authorization decision should follow the same architecture, use the same abstractions, and produce the same style of result.

Consistency is more valuable than cleverness.

A predictable architecture is easier to understand, easier to maintain, easier to test, and significantly easier to evolve as Kizunia grows.

These conventions exist to preserve that consistency across every contributor and every future feature.