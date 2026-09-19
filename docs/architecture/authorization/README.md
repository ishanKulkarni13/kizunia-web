# Kizunia Authorization Architecture

> **Status:** Stable
>
> **Version:** 1.0
>
> **Audience:** Backend Developers, Frontend Developers, Contributors
>
> **Last Updated:** 2026-07-19

---

# Introduction

Welcome to the Kizunia Authorization Architecture.

This directory contains the complete design and implementation philosophy behind Kizunia's authorization system.

Authorization is one of the most important parts of the platform. It determines **who can perform what action on which resource** while keeping the codebase maintainable, scalable, secure, and easy to understand.

Unlike many applications where authorization logic becomes scattered throughout API routes, services, and frontend components, Kizunia follows a centralized authorization architecture.

The goal is simple:

> **Every authorization decision should come from a single source of truth.**

---

# Why This Exists

As Kizunia grows, the platform will contain many different resources.

Examples include:

- Projects
- Teams
- Blogs
- Hackathons
- Portfolios
- Administration
- Future Features

Each of these resources will expose different actions.

Examples:

- Edit
- Delete
- Archive
- Publish
- Manage Members
- Transfer Ownership
- Review
- Verify

If authorization rules are implemented directly inside API routes or frontend components, the project quickly becomes difficult to maintain.

Changing a single permission may require modifications across dozens of files.

This architecture exists to prevent that problem.

---

# Design Goals

The authorization system has been designed with the following goals.

## Single Source of Truth

Authorization logic should exist in exactly one place.

Changing a permission should never require editing multiple parts of the application.

---

## Framework Independent

The authorization layer should remain independent of:

- Next.js
- Prisma
- React
- Database implementation
- HTTP APIs

The authorization engine should only evaluate rules.

It should never be responsible for loading data or communicating with external systems.

---

## Shared Between Frontend and Backend

Frontend and Backend should use the exact same authorization logic.

This ensures:

- consistent UI
- consistent API behavior
- reduced duplication
- fewer bugs

The frontend uses authorization to determine what should be displayed.

The backend uses authorization to enforce security.

Although both use the same logic, **only the backend is trusted.**

---

## Highly Maintainable

Permissions should be easy to modify.

Adding:

- new roles
- new actions
- new resources

should require minimal changes to the codebase.

---

## Extensible

The architecture should support future features without requiring large rewrites.

Examples include:

- Custom Roles
- Feature Flags
- Premium Features
- Marketplace
- AI Features
- Organizations
- Public API

Even if these features are never implemented, the architecture should naturally support them.

---

## Easy to Understand

Authorization should be understandable by any contributor.

A new developer should be able to answer questions such as:

- Who can edit a project?
- Why can't this user delete a team?
- Which permissions does a maintainer have?

without searching throughout the codebase.

---

# Scope

This documentation covers every aspect of authorization within Kizunia.

Topics include:

- Design Philosophy
- Architecture
- Request Lifecycle
- Resource Contexts
- Authorizers
- Actions
- Capabilities
- Abilities
- Authorization Decisions
- Frontend Integration
- Backend Integration
- Better Auth Integration
- Performance
- Testing
- Best Practices
- Future Expansion

---

# What This Documentation Does NOT Cover

The following topics are intentionally documented elsewhere.

## Domain Models

Documentation describing business entities such as:

- User
- Project
- Team
- Blog
- Portfolio

can be found in:

```
docs/architecture/domain/
```

---

## Product Features

Feature specifications and product requirements are documented under:

```
docs/project/
```

---

## Database Design

Prisma schemas and database implementation are documented separately.

Authorization intentionally remains independent of the database.

---

# Reading Order

The recommended reading order is:

```
README.md
    ↓
philosophy.md
    ↓
architecture.md
    ↓
implementation.md
    ↓
conventions.md
```

Each document builds upon the previous one.

Reading them in order is strongly recommended.

---

# High-Level Overview

The authorization system can be visualized as follows.

```
                        User Request
                             │
                             ▼
                    Authentication
                     (Better Auth)
                             │
                             ▼
                   Resource Loading
                             │
                             ▼
                  Authorization Engine
                             │
                             ▼
                Authorization Decision
                             │
               ┌─────────────┴─────────────┐
               ▼                           ▼
        Business Logic              Frontend UI
```

Authentication establishes **who the user is**.

Authorization determines **what the user is allowed to do**.

Business logic performs the requested operation.

The frontend consumes authorization results only for user experience.

---

# Core Concepts

Throughout this documentation several important terms will be used.

---

## Authentication

Authentication answers the question:

> **Who is the current user?**

Authentication is handled entirely by Better Auth.

---

## Authorization

Authorization answers:

> **Can this authenticated user perform this action on this specific resource?**

Authorization is implemented entirely by Kizunia.

---

## Resource

A Resource represents an entity being protected.

Examples include:

- Project
- Team
- Blog
- Hackathon

Each resource defines its own authorization rules.

---

## Action

An Action represents something a user wants to perform.

Examples:

- Edit
- Delete
- Publish
- Archive
- Transfer Ownership

Actions are evaluated by Authorizers.

---

## Capability

Capabilities represent permissions granted to a role.

Examples:

```
Project Owner

↓

EDIT_PROJECT

DELETE_PROJECT

TRANSFER_PROJECT
```

Capabilities are implementation details.

Frontend should never directly depend on them.

---

## Ability

Abilities are the evaluated authorization results returned to the frontend.

Example:

```json
{
    "edit": true,
    "delete": false,
    "transfer": false
}
```

Abilities are generated dynamically for a specific user and resource.

---

## Authorizer

An Authorizer is responsible for evaluating authorization rules for one resource.

Examples:

- ProjectAuthorizer
- TeamAuthorizer
- BlogAuthorizer

Every resource owns exactly one Authorizer.

---

## Authorization Decision

Every authorization request returns an Authorization Decision.

Example:

```json
{
    "allowed": false,
    "code": "NOT_PROJECT_OWNER",
    "message": "Only project owners can transfer ownership."
}
```

Authorization never returns simple boolean values.

---

# Guiding Principles

Every design decision in this authorization system follows these principles.

- Authentication and Authorization are separate concerns.
- Authorization and Business Rules are separate concerns.
- Frontend is never trusted.
- Backend always performs authorization.
- Authorization should remain centralized.
- Authorization should be deterministic.
- Authorizers should remain pure.
- Business services should never perform authorization.
- Permissions should be easy to change.
- Frontend should never depend on roles.

These principles will be explained throughout the remaining documentation.

---

# Contributing

Before modifying the authorization system, contributors are expected to read this documentation completely.

Authorization is a foundational subsystem.

Changes should not be made without understanding the architectural decisions behind it.

If a change requires altering the architecture itself, the documentation **must be updated before implementation begins.**

The documentation is considered the source of truth.

---

# Future Evolution

This architecture has been intentionally designed to evolve.

Future versions of Kizunia may introduce:

- Custom Roles
- Dynamic Policies
- AI Moderation
- Feature Flags
- Marketplace Permissions
- Public APIs
- Enterprise Features

The architecture should accommodate these additions without requiring significant redesign.

---

# Final Thoughts

Authorization is not simply a collection of permission checks.

It is a foundational architectural subsystem responsible for ensuring consistency, security, maintainability, and developer experience across the entire platform.

Every resource, every API, every frontend component, and every future feature should rely on this authorization system rather than implementing custom permission logic.

By centralizing authorization and keeping it independent of frameworks, databases, and business logic, Kizunia aims to build a platform that remains easy to understand and maintain as it grows.

The following documents describe every aspect of this system in detail.