# Authorization Foundation

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
> - `architecture.md`
> - `implementation.md`
> - `conventions.md`

---

# Purpose

Before implementing or modifying any authorization logic within Kizunia, contributors should understand the concepts that form the foundation of the authorization system.

This document explains those concepts.

Unlike `architecture.md`, which focuses on how the system is structured, this document focuses on what each concept means and why it exists.

Understanding these concepts is essential before contributing to the authorization subsystem.

---

# Authentication

Authentication answers a single question:

> **Who is the current user?**

Authentication verifies identity.

Kizunia delegates authentication entirely to **Better Auth**.

Examples include:

- Email & Password
- Google OAuth
- GitHub OAuth
- Future authentication providers

Authentication establishes the identity of the current actor.

It does **not** determine what that actor is allowed to do.

Authentication ends the moment we know who the user is.

Everything after that belongs to Authorization.

---

# Authorization

Authorization answers a different question.

> **Can the authenticated actor perform this action on this resource?**

Examples:

- Can Alice edit Project A?
- Can Bob publish this Blog?
- Can Charlie archive this Hackathon?
- Can David review this Blog?

Authorization depends on far more than identity.

It may depend on:

- Platform Role
- Resource Role
- Ownership
- Resource State
- Verification
- Visibility
- Future Subscription Plans
- Future Feature Flags

Authentication identifies the actor.

Authorization evaluates permissions.

These are two completely different concerns.

---

# Actor

An Actor represents the authenticated identity attempting to perform an operation.

In most cases, the Actor is simply the authenticated User.

Future versions of Kizunia may also support other actors such as:

- API Keys
- Service Accounts
- Bots
- Automation

The authorization system intentionally uses the generic term **Actor** instead of **User** so the architecture remains flexible.

---

# Resource

A Resource is anything protected by the authorization system.

Examples include:

- Project
- Team
- Blog
- Hackathon
- Portfolio

Every Resource owns:

- Actions
- Roles
- Permission Sets
- Authorizer
- Context

Authorization is always evaluated against a specific Resource.

---

# Action

An Action represents an operation being attempted.

Examples:

Project Actions:

- View
- Edit
- Delete
- Archive
- Restore
- Transfer Ownership

Blog Actions:

- Edit
- Publish
- Delete
- Approve

Hackathon Actions:

- Edit
- Publish
- Verify Organizer

Actions describe **what is happening**, not **who is performing it**.

---

# Platform Roles

Platform Roles define a user's responsibilities across the entire platform.

Examples may include:

- User
- Moderator
- Admin
- Owner

Platform Roles are global.

They are independent of any individual Project or Team.

For example:

A Platform Admin may manage any Project regardless of project membership.

---

# Resource Roles

Resource Roles exist only within a specific Resource.

For example:

Project:

- Owner
- Maintainer
- Contributor

Team:

- Owner
- Maintainer
- Member

Resource Roles are completely independent.

A Project Maintainer is unrelated to a Team Maintainer.

Every Resource defines its own hierarchy.

---

# Permission Sets

Every Role maps to a predefined Permission Set.

Example:

Project Owner

↓

- Edit
- Delete
- Archive
- Restore
- Manage Members
- Transfer Ownership

Project Maintainer

↓

- Edit
- Manage Media
- Manage Links

Permission Sets are static.

They are defined inside the codebase.

They are never modified at runtime.

Keeping Permission Sets inside the codebase provides:

- Type Safety
- Version Control
- Code Review
- Predictable Deployments

---

# Context

Context represents everything required to evaluate authorization.

Instead of evaluating:

```
(projectId, userId)
```

the Authorizer evaluates:

```
ProjectContext
```

The Context may contain:

- Actor
- Resource
- Resource Role
- Platform Role
- Ownership
- Verification
- Visibility

The Authorizer never requests additional information.

Everything required already exists inside the Context.

---

# Context Resolver

A Context Resolver is responsible for constructing Context objects.

Its responsibilities include:

- Loading Resources
- Loading Memberships
- Resolving Platform Roles
- Resolving Ownership
- Resolving Verification

The Context Resolver performs all required data retrieval before authorization begins.

The Authorizer never communicates with the database.

---

# Authorizer

The Authorizer evaluates authorization.

Every Resource owns exactly one Authorizer.

Examples:

- ProjectAuthorizer
- TeamAuthorizer
- BlogAuthorizer
- HackathonAuthorizer

The Authorizer receives a Context and evaluates whether an Action should be permitted.

Authorizers are pure.

They:

- Never query databases
- Never execute business logic
- Never modify data
- Never return HTTP responses

They only evaluate authorization.

---

# Authorization Decision

Every authorization request returns an Authorization Decision.

Never a boolean.

Example:

```ts
{
    allowed: true
}
```

or

```ts
{
    allowed: false,
    code: "NOT_OWNER",
    message: "Only project owners can archive projects."
}
```

Authorization Decisions provide:

- Better error handling
- Better frontend UX
- Better logging
- Better debugging
- Future extensibility

---

# Abilities

Abilities are generated from the Authorizer for a specific Context.

Example:

```ts
const abilities =
    authorize.project.abilities(context);
```

Result:

```ts
{
    view: true,
    edit: true,
    archive: false,
    delete: false
}
```

The frontend renders itself using Abilities.

It never renders itself using Roles.

This keeps UI independent from authorization rules.

---

# Business Rules

Authorization and Business Rules are different.

Authorization answers:

> Can this action be attempted?

Business Rules answer:

> Can this operation succeed?

Example:

```
User can Edit Project

↓

Authorization Passed

↓

Project Archived

↓

Business Rule Failed
```

Both are required.

Neither replaces the other.

Keeping them separate greatly simplifies the architecture.

---

# Relationship Between Concepts

Every concept introduced in this document plays a specific role within the authorization subsystem.

The following diagram illustrates how they relate to one another.

```
Authentication
        │
        ▼
      Actor
        │
        ▼
Resource + Context Resolver
        │
        ▼
      Context
        │
        ▼
    Authorizer
        │
        ▼
Authorization Decision
        │
        ├──────────────► Backend
        │                   │
        │                   ▼
        │             Business Service
        │
        └──────────────► Frontend
                            │
                            ▼
                         Abilities
```

Every concept exists to solve one specific problem.

Understanding this flow is the key to understanding Kizunia's authorization architecture.

---

# Complete Authorization Flow

The following sequence represents a complete authorization request.

```
User

↓

Better Auth

↓

Authenticated Actor

↓

Context Resolver

↓

Authorization Context

↓

Authorizer

↓

Authorization Decision

↓

Business Service

↓

Repository

↓

Database
```

Notice that authorization always completes before business logic begins.

This ensures business logic never needs to concern itself with permissions.

---

# Why We Use Resource-Based Authorization

Many applications organize permissions around routes.

For example:

```
PATCH /projects/:id

↓

Require OWNER
```

This tightly couples HTTP routes with authorization.

Kizunia instead organizes authorization around Resources.

Example:

```
Project

↓

ProjectAuthorizer
```

Regardless of whether the request comes from:

- REST API
- Server Action
- Mobile App
- Background Job

the same ProjectAuthorizer evaluates authorization.

This keeps authorization independent of transport mechanisms.

---

# Why We Avoid Role Checks

Role checks appear simple.

Example:

```ts
if(member.role === "OWNER")
```

However, this approach spreads authorization rules throughout the codebase.

If requirements change, dozens of files may require updates.

Instead, every permission check should delegate to the Authorizer.

Example:

```ts
authorize.project.archive(context)
```

The caller does not know:

- Roles
- Permission Sets
- Ownership Rules
- Platform Rules

It only knows whether the requested operation is permitted.

---

# Why We Use Context

Without Context, every authorization method would need to retrieve information.

Example:

```ts
authorize.project.edit(projectId, actorId)
```

Internally it would need to load:

- Project
- Membership
- Platform Role
- Ownership

Instead, Context provides everything in advance.

```
Context

↓

Authorizer

↓

Decision
```

The Authorizer becomes deterministic, predictable, and easy to test.

---

# Why We Return Authorization Decisions

Returning a boolean answers only one question.

```
Allowed?

Yes

No
```

Real applications usually need much more information.

Examples include:

- Why was it denied?
- Should the UI hide this button?
- Should the action be disabled?
- Should we display a tooltip?
- Should this event be logged?
- Should the user upgrade their subscription?

Authorization Decisions provide a structured answer.

They are significantly more expressive than primitive values.

---

# Common Misconceptions

## Authentication Is Authorization

False.

Authentication identifies the Actor.

Authorization determines permissions.

---

## Roles Are Permissions

False.

Roles map to Permission Sets.

Permission Sets determine authorization.

---

## Frontend Authorization Provides Security

False.

Frontend authorization only improves user experience.

The backend always performs authorization again.

---

## Services Should Perform Authorization

False.

Services execute business logic.

Authorization completes before the Service executes.

---

## Authorizers Should Query The Database

False.

Authorizers evaluate Context.

Context Resolvers retrieve data.

---

## Context Is A DTO

False.

A DTO transfers data between layers.

A Context represents everything required for authorization.

These are separate concepts.

---

# Mental Model

The following mental model should always be used when reasoning about authorization.

```
Actor

attempts

Action

against

Resource

using

Context

↓

Authorizer

↓

Authorization Decision
```

Every authorization scenario within Kizunia can be described using this model.

---

# Enterprise Design Principles

The authorization subsystem follows several guiding principles.

## Single Responsibility

Every layer performs one responsibility.

Nothing more.

Nothing less.

---

## Explicitness

Authorization should never be hidden inside unrelated classes.

It should always be obvious where authorization occurs.

---

## Determinism

The same Context always produces the same Authorization Decision.

---

## Framework Independence

Authorization should remain independent of:

- Next.js
- Express
- Prisma
- React
- Database implementation

This allows the subsystem to evolve without requiring architectural changes.

---

## Resource Isolation

Every Resource owns:

- Actions
- Permission Sets
- Context
- Authorizer

Resources evolve independently.

---

## Documentation First

Architectural decisions should be documented before implementation.

Documentation is considered the source of truth.

---

# Terminology Reference

| Term | Meaning |
|------|---------|
| Authentication | Verifies identity |
| Authorization | Evaluates permissions |
| Actor | Authenticated identity performing an action |
| Resource | Protected entity |
| Action | Operation being attempted |
| Platform Role | Global platform role |
| Resource Role | Role within a specific resource |
| Permission Set | Static permissions granted to a role |
| Context | Complete authorization data |
| Context Resolver | Builds Context |
| Authorizer | Evaluates authorization |
| Authorization Decision | Result of authorization |
| Ability | Frontend-friendly authorization result |
| Business Rule | Determines whether an authorized operation may succeed |

---

# Summary

The authorization subsystem is built upon a small number of carefully defined concepts.

Each concept has exactly one responsibility.

```
Authentication

↓

Actor

↓

Resource

↓

Context Resolver

↓

Context

↓

Authorizer

↓

Authorization Decision

↓

Business Logic
```

This architecture provides:

- Clear separation of responsibilities
- Strong maintainability
- Excellent testability
- Predictable authorization behavior
- Shared frontend and backend logic
- Enterprise scalability

By keeping every concept focused and independent, Kizunia avoids the scattered permission logic that commonly appears in large applications.

As the platform grows, new Resources, Roles, Actions, and Permission Sets can be introduced without changing the fundamental architecture.

This foundation should guide every authorization-related implementation within Kizunia and serve as the common language for all contributors.