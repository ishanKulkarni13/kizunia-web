# Authorization Architecture

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
> **Depends On:**
>
> - `README.md`
>
> **Related Documents:**
>
> - `foundation.md`
> - `implementation.md`
> - `conventions.md`

---

# Architecture Rules

This document defines the architecture of Kizunia's authorization subsystem.

Unlike implementation documents, this file focuses on **how the system is structured**, **how information flows**, and **how different components interact**.

This document intentionally avoids implementation-specific details such as:

- Framework-specific code
- Prisma queries
- Better Auth configuration
- Route handlers
- Controllers
- DTOs

Those topics are covered elsewhere.

If implementation requires changing the architecture described in this document, the architecture **must be updated first** before any code changes are introduced.

The documentation is considered the source of truth.

---

# Purpose

The authorization subsystem exists to answer one question.

> **Can this actor perform this action on this resource?**

Every authorization decision within Kizunia should be answered consistently regardless of whether the request originates from:

- A REST API
- A Server Action
- A React Server Component
- A Client Component
- A Mobile Application
- A Future Public API

This consistency is one of the primary goals of the architecture.

---

# Design Goals

The authorization architecture has been designed around several long-term goals.

## Centralized

Authorization logic should exist in one place.

Changing a permission should never require searching across controllers, services, repositories, or frontend components.

---

## Predictable

The same authorization request should always produce the same decision when evaluated against the same context.

Authorization should behave as a deterministic system rather than a collection of scattered conditional statements.

---

## Framework Independent

Authorization should not depend on:

- Next.js
- Prisma
- React
- HTTP
- REST
- Database implementation

The authorization subsystem should remain portable and testable in complete isolation.

---

## Resource Oriented

Authorization should be organized around resources rather than around routes.

Examples include:

- Project
- Team
- Blog
- Hackathon

Each resource owns its own authorization rules.

This prevents unrelated resources from becoming coupled.

---

## Shared

The frontend and backend should evaluate authorization using the same logic.

Frontend uses authorization to improve user experience.

Backend uses authorization to enforce security.

Although both share the same implementation, **only backend authorization is trusted**.

---

## Extensible

Adding:

- new resources
- new actions
- new capabilities
- new roles

should require minimal modifications to the existing architecture.

The system should naturally evolve as the platform grows.

---

# High-Level Architecture

The authorization subsystem sits between authentication and business logic.

```

                    User Request
                          │
                          ▼
                 Authentication
                  (Better Auth)
                          │
                          ▼
                 Context Resolver
                          │
                          ▼
                   Authorization
                    (Authorizer)
                          │
                Authorization Decision
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
      Business Logic           Frontend Abilities

```

Each layer has exactly one responsibility.

No layer should perform work belonging to another layer.

---

# Responsibilities

## Authentication

Authentication answers:

> Who is making this request?

Authentication is delegated entirely to Better Auth.

It establishes identity.

It does **not** determine permissions.

---

## Context Resolver

The Context Resolver prepares all information required for authorization.

Examples include:

- Current user
- Platform role
- Resource
- Membership
- Ownership
- Visibility
- Verification
- Future feature flags

The resolver performs all required data loading before authorization begins.

---

## Authorizer

The Authorizer evaluates whether an action should be permitted.

Authorizers never perform database queries.

Authorizers never execute business logic.

Authorizers only evaluate rules using the provided context.

---

## Business Logic

Business logic executes only after authorization succeeds.

Business logic assumes authorization has already completed successfully.

It should never perform permission checks.

---

## Repository

Repositories are responsible only for persistence.

Repositories should never contain authorization logic.

Repositories should never contain business rules.

They simply interact with the database.

---

# Separation of Responsibilities

One of the most important architectural principles within Kizunia is strict separation of responsibilities.

| Layer | Responsibility |
|---------|---------------|
| Better Auth | Identity |
| Context Resolver | Build authorization context |
| Authorizer | Evaluate permissions |
| Service | Execute business rules |
| Repository | Database interaction |

Every layer performs exactly one responsibility.

This separation dramatically improves maintainability as the project grows.

---

# Why This Architecture Exists

Many applications begin with authorization implemented directly inside controllers, route handlers, or services.

For example:

```ts
if (projectMember.role !== "OWNER") {
    throw new ForbiddenException();
}
```

Although this approach appears simple, it quickly becomes problematic as the application grows.

The same authorization rule may be duplicated across multiple API endpoints, frontend components, server actions, and background jobs.

As the number of resources increases, maintaining consistency becomes increasingly difficult.

For example:

- One endpoint may allow maintainers to edit a project.
- Another endpoint may accidentally restrict editing to owners only.
- The frontend may display an Edit button based on outdated role checks.
- A mobile application may implement a slightly different permission model.

Although each implementation appears correct in isolation, together they produce an inconsistent user experience and introduce security risks.

Kizunia intentionally avoids this pattern.

Instead, every authorization decision originates from a centralized Authorizer.

Regardless of whether the request originates from:

- A REST API
- A Server Action
- A React Component
- A Future Mobile Application

the same Authorizer evaluates the same rules using the same context.

This guarantees consistency across the platform.

---

# Request Lifecycle

Every protected request follows the same lifecycle.

```

                    User Request
                          │
                          ▼
                 Authentication
                  (Better Auth)
                          │
                          ▼
                 Context Resolver
                          │
                          ▼
                    Authorizer
                          │
                          ▼
             Authorization Decision
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
      Authorization Failed      Authorization Granted
            │                           │
            ▼                           ▼
       Return Error              Business Service
                                        │
                                        ▼
                                   Repository
                                        │
                                        ▼
                                     Database

```

Every request follows this lifecycle regardless of the resource involved.

The architecture intentionally avoids introducing resource-specific variations.

Consistency is preferred over clever optimizations.

---

# Why Context Resolution Exists

One of the most important architectural decisions within Kizunia is the introduction of Context Resolvers.

Instead of passing only identifiers into the authorization layer:

```ts
authorize.project.edit(projectId, userId)
```

Kizunia resolves all required information before authorization begins.

Example:

```ts
const context = await projectContextResolver.resolve({
    projectId,
    userId
});
```

The resulting context contains every piece of information required to evaluate authorization.

For example:

- Current actor
- Platform role
- Project
- Project membership
- Visibility
- Verification state
- Future metadata

The Authorizer therefore never performs database queries.

---

# Why Not Query Inside Authorizers?

It may seem convenient for an Authorizer to retrieve information directly.

For example:

```ts
async edit(projectId, userId) {
    const membership =
        await prisma.projectMember.findUnique(...);
}
```

Kizunia intentionally rejects this design.

There are several reasons.

## Single Responsibility

An Authorizer should evaluate authorization.

It should not retrieve data.

Mixing persistence with authorization creates unnecessary coupling.

---

## Testability

A pure Authorizer can be tested without:

- Prisma
- Database
- Better Auth
- HTTP

A unit test only needs to construct a Context object.

Example:

```ts
const decision = ProjectAuthorizer.edit(context);
```

This dramatically simplifies testing.

---

## Performance

A Context Resolver loads all required information once.

Without Context Resolvers, multiple Authorizers may independently execute identical database queries.

This leads to duplicated work and unnecessary database load.

---

## Predictability

Because every Authorizer receives the same Context object, authorization behaves consistently regardless of where it is executed.

The Authorizer never depends on external state.

---

# Why Not Authorize Inside Services?

Another common design is to place authorization inside Services.

For example:

```ts
class ProjectService {

    async updateProject(...) {

        if(member.role !== "OWNER") {
            ...
        }

    }

}
```

Kizunia intentionally avoids this approach.

Services are responsible for business logic.

They should never determine whether a request is permitted.

Instead, Services assume authorization has already succeeded.

This separation produces significantly cleaner services and greatly simplifies testing.

---

# Why Controllers Do Not Authorize

Controllers coordinate requests.

Their responsibilities include:

- Receiving HTTP requests
- Validating input
- Invoking application services
- Returning responses

Controllers should remain extremely thin.

Instead of implementing permission logic themselves, Controllers delegate authorization to the Authorizer.

This keeps Controllers focused entirely on request orchestration.

---

# Enterprise Layered Architecture

The backend architecture intentionally follows a layered design.

```

Controller
      │
      ▼
Service
      │
      ├──▶ Context Resolver
      │
      ├──▶ Authorizer
      │
      ▼
Repository
      │
      ▼
Database

```

Each layer communicates only with its immediate neighbors.

Responsibilities never overlap.

This makes the codebase easier to understand, test, and evolve.

> **Note:** an earlier revision of this document placed Context Resolution
> and Authorization in the Controller, ahead of the Service. Kizunia has
> since moved both into the Service (see "Why Services Resolve Context And
> Authorize" below) so the Controller can stay a pure HTTP boundary
> (Authenticate → Validate → delegate) and Services can assemble a context
> from data they already need to load, without a second round trip.

---

# Layer Responsibilities

## Controller

Responsible for:

- Authentication
- Request validation
- DTO mapping
- Invoking the Service
- Returning HTTP responses

Controllers should never:

- Query the database directly
- Execute business rules
- Perform authorization
- Resolve authorization context

---

## Context Resolver

Responsible for assembling the complete authorization context.

Context Resolvers may:

- Load resources
- Load memberships
- Determine ownership
- Determine platform roles
- Resolve future authorization metadata

Context Resolvers should not execute business logic.

Context Resolvers are invoked by the Service, at the start of each Service
method, before any business logic runs. A Service should prefer the
Resolver's `fromData(...)` variant whenever it has already loaded the
resource/membership for another reason, to avoid duplicate queries.

---

## Authorizer

Responsible only for authorization.

Authorizers:

- Receive Context
- Evaluate rules
- Produce Authorization Decisions

They never communicate with external systems.

Authorizers are invoked by the Service, immediately after Context
Resolution and before any business logic executes.

---

## Service

Responsible for business logic — and, in Kizunia, for authorization as well.

Each Service method:

1. Resolves the authorization Context (via a Context Resolver).
2. Authorizes the action (via the resource's Authorizer).
3. Executes business logic only once step 2 has succeeded.

Examples of business logic include:

- Updating project metadata
- Publishing a blog
- Creating a hackathon
- Transferring ownership

Services must still never contain authorization *rules* — those live in
the Policy/PermissionSet, evaluated by the Authorizer. The Service only
decides *when* to resolve context and call the Authorizer, not *how* a
decision is made.

---

## Repository

Responsible only for persistence.

Repositories:

- Read data
- Write data
- Execute transactions

Repositories never contain authorization logic.

Repositories never contain business rules.

---

# Authorizers

Authorizers are the heart of Kizunia's authorization architecture.

Every authorization decision within the platform is ultimately evaluated by an Authorizer.

Regardless of whether the request originates from:

- REST API
- Server Action
- React Server Component
- Client Component
- Future Mobile Application
- Future Public API

every permission check should eventually reach an Authorizer.

Authorizers provide a single source of truth for authorization.

---

# What Is An Authorizer?

An Authorizer is a resource-specific component responsible for answering one question.

> **Can this actor perform this action on this resource?**

An Authorizer does not know:

- HTTP
- Controllers
- Services
- Prisma
- Database
- UI
- React
- Next.js

Its only responsibility is evaluating authorization.

---

# One Authorizer Per Resource

Every protected resource owns exactly one Authorizer.

Examples include:

```
Project
        │
        ▼
ProjectAuthorizer
```

```
Team
      │
      ▼
TeamAuthorizer
```

```
Blog
      │
      ▼
BlogAuthorizer
```

```
Hackathon
           │
           ▼
HackathonAuthorizer
```

Keeping Authorizers resource-specific allows each resource to evolve independently.

For example, Project authorization rules may become significantly more complex than Blog authorization rules.

Separating them avoids unnecessary coupling.

---

# Responsibilities

Authorizers are responsible for:

- Evaluating permissions
- Evaluating ownership
- Evaluating memberships
- Evaluating capabilities
- Producing Authorization Decisions

Authorizers are **not** responsible for:

- Querying the database
- Executing business logic
- Updating resources
- Sending notifications
- Logging
- Returning HTTP responses

---

# Authorizer API

Every Authorizer exposes resource-specific methods.

For example:

```ts
authorize.project.view(context)

authorize.project.edit(context)

authorize.project.delete(context)

authorize.project.archive(context)

authorize.project.transferOwnership(context)

authorize.project.manageMembers(context)
```

Likewise:

```ts
authorize.team.edit(context)

authorize.team.inviteMember(context)

authorize.team.removeMember(context)
```

Notice that every method represents a business action.

There is no generic:

```ts
authorize(resource, action)
```

Although generic authorization systems are flexible, they tend to become difficult to understand as applications grow.

Kizunia intentionally favors explicit APIs.

---

# Why Explicit Methods?

Consider the following.

```
Edit Project
```

may require:

- Owner
- Maintainer
- Project not archived

Whereas

```
Transfer Ownership
```

may require:

- Owner only
- New owner exists
- Project not locked

Although both are "permissions", their requirements differ significantly.

Using explicit methods allows each authorization rule to evolve independently.

---

# Context

Every Authorizer receives exactly one Context object.

Example:

```ts
authorize.project.edit(context)
```

The Context contains every piece of information required to evaluate authorization.

Typical information includes:

- Current actor
- Resource
- Membership
- Platform role
- Ownership
- Verification
- Visibility

Future versions may include:

- Subscription
- Feature Flags
- Organization Membership
- Licensing
- Temporary Access

The Authorizer does not care how the Context was produced.

Its only responsibility is evaluating it.

---

# Authorization Decision

Every authorization request returns an Authorization Decision.

Authorizers never return primitive values such as:

```ts
true
```

or

```ts
false
```

Instead they return a structured object.

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

    code: "NOT_PROJECT_OWNER",

    message:
        "Only project owners can transfer ownership."
}
```

This design provides several advantages.

---

## Better Error Handling

Instead of simply receiving:

```
403 Forbidden
```

the application understands **why** authorization failed.

Examples:

- Resource Archived
- Not Project Member
- Owner Required
- Verification Required

---

## Better Frontend Experience

The frontend can display meaningful information.

Example:

```
Transfer Ownership

Disabled

Reason:

Only project owners can transfer ownership.
```

instead of hiding functionality entirely.

---

## Better Logging

Authorization failures become self-descriptive.

Audit logs can record:

- User
- Resource
- Action
- Decision
- Failure Code

without requiring additional interpretation.

---

# Abilities

Authorizers expose another important method.

```
abilities(context)
```

Unlike action-specific methods, abilities are intended primarily for the frontend.

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

    delete: false,

    archive: true,

    manageMembers: true,

    transferOwnership: false
}
```

The frontend now renders itself using Abilities instead of Roles.

---

# Why Not Check Roles?

A common frontend implementation looks like:

```tsx
if(member.role === "OWNER")
```

This tightly couples UI components to authorization rules.

Suppose tomorrow Maintainers are also allowed to edit projects.

Every component containing role checks must now be updated.

Instead:

```tsx
if(abilities.edit)
```

The component knows nothing about:

- Roles
- Ownership
- Membership
- Business Rules

It only knows what the current user is allowed to do.

This dramatically reduces coupling between UI and authorization.

---

# Backend Still Authorizes

Although the frontend consumes Abilities, the backend never trusts the frontend.

Every mutation performs authorization again.

Example:

```ts
const decision =
    authorize.project.edit(context);

if(!decision.allowed)
    throw new ForbiddenException();
```

Frontend authorization exists solely to improve user experience.

Backend authorization exists to guarantee security.

---

# Shared Authorization

One of the primary goals of this architecture is code sharing.

The exact same Authorizer implementation should be used by:

- Controllers
- Server Actions
- React Server Components
- Client Components
- Future Mobile Applications

This ensures that every platform evaluates permissions consistently.

Changing an authorization rule immediately affects every consumer.

No duplicated permission logic exists anywhere in the application.

---

# Why This Scales

Imagine a new project role is introduced.

```
Documentation Maintainer
```

Instead of modifying:

- Controllers
- Services
- Components
- API Routes

only the ProjectAuthorizer requires modification.

Every consumer automatically benefits from the updated authorization rules.

This dramatically reduces maintenance cost as the platform evolves.

---

# Guiding Principle

Authorizers should answer one question exceptionally well.

> **Can this actor perform this action on this resource?**

They should never attempt to answer questions outside this responsibility.

Maintaining this discipline keeps the authorization subsystem predictable, testable, and easy to evolve.

---

# Actions

Actions represent operations that may be performed on a resource.

Every authorization decision ultimately evaluates whether an Actor is allowed to perform an Action on a Resource.

An Action should always describe **what is being attempted**, never **who is attempting it**.

For example:

```
Project
    ├── View
    ├── Edit
    ├── Delete
    ├── Archive
    ├── Restore
    ├── Transfer Ownership
    ├── Manage Members
    ├── Manage Links
    ├── Manage Media
    └── Edit Documentation
```

Notice that these actions describe operations rather than permissions.

---

# Every Resource Owns Its Actions

Actions belong to their respective resources.

For example:

```
ProjectAction

Edit

Delete

Archive

Restore

TransferOwnership
```

```
TeamAction

Edit

Delete

InviteMember

RemoveMember

TransferOwnership
```

```
BlogAction

Edit

Delete

Publish

Unpublish

Review

Approve
```

Keeping actions resource-specific prevents unrelated resources from becoming coupled.

For example:

`TransferOwnership` exists for Projects and Teams.

It does not necessarily make sense for Blogs.

---

# Why We Do Not Use Global Actions

A common implementation defines actions globally.

Example:

```ts
enum Action {

    CREATE,

    READ,

    UPDATE,

    DELETE

}
```

Although simple, this approach quickly becomes restrictive.

Different resources naturally expose different operations.

A Hackathon may support:

- Publish Results
- Verify Organizer
- Manage Sponsors

A Portfolio may support:

- Feature Project
- Reorder Sections

Trying to force every operation into a generic CRUD model results in awkward abstractions.

Kizunia therefore treats every resource independently.

---

# Actions Are Stable

Actions represent business operations.

They should rarely change.

Permissions may evolve.

Roles may evolve.

Capabilities may evolve.

However, the operation itself usually remains stable.

For example:

```
Edit Project
```

will always exist.

Who may edit the project may change.

The action itself should not.

---

# Capabilities

Capabilities represent what a role is allowed to perform.

Actions answer:

> What is being attempted?

Capabilities answer:

> What is this role allowed to perform?

Example:

```
Project Owner

↓

EDIT_PROJECT

DELETE_PROJECT

TRANSFER_PROJECT

MANAGE_MEMBERS
```

```
Project Maintainer

↓

EDIT_PROJECT

MANAGE_MEDIA

EDIT_DOCUMENTATION
```

```
Project Contributor

↓

VIEW_PROJECT
```

Capabilities are internal implementation details.

The frontend should never directly depend on them.

---

# Why Capabilities Instead of Role Checks?

Imagine the frontend contains:

```tsx
if(member.role === "OWNER")
```

Now imagine we decide that Maintainers should also edit projects.

Every component containing that role check must be updated.

Instead, roles map to capabilities.

Capabilities determine authorization.

Frontend only consumes evaluated abilities.

The flow becomes:

```
Role

↓

Capabilities

↓

Authorizer

↓

Abilities

↓

Frontend
```

Notice that the UI no longer knows anything about roles.

---

# Role Mapping

Every resource defines its own role hierarchy.

Example:

```
Project

↓

Owner

↓

Maintainer

↓

Contributor
```

Each role owns a predefined set of capabilities.

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

Manage Media

Manage Links

Edit Documentation
```

```
Contributor

↓

View
```

Role definitions should remain centralized.

They should never be duplicated across controllers, services, or components.

---

# Why Capabilities Are Defined In Code

Capabilities are intentionally defined inside the codebase rather than inside the database.

This provides several advantages.

## Version Control

Permission changes become part of Git history.

Every modification is reviewed through Pull Requests.

---

## Predictability

Production behavior cannot accidentally change because of an unexpected database update.

Authorization rules evolve only through code changes.

---

## Type Safety

Using TypeScript enums or literal types provides compile-time safety.

Example:

```ts
ProjectCapability.EDIT_PROJECT
```

instead of:

```ts
"edit_project"
```

---

## Better Refactoring

Renaming a capability updates the entire codebase automatically.

String literals provide no such guarantees.

---

# Ability Generation

Capabilities are implementation details.

Abilities are the final authorization result.

Example:

```
Capabilities

↓

Evaluate Context

↓

Generate Abilities
```

Result:

```ts
{

    view: true,

    edit: true,

    delete: false,

    archive: true,

    manageMembers: true

}
```

Abilities are generated dynamically for every request.

They are not stored.

---

# Dynamic Authorization

Authorization is always evaluated against the current Context.

This means permissions may change depending on the resource.

Example:

```
Project Alpha

↓

Owner

↓

Can Edit
```

```
Project Beta

↓

Contributor

↓

Cannot Edit
```

The same user receives different authorization results depending on the Context.

This flexibility is one of the primary strengths of resource-based authorization.

---

# Authorization Is Context-Aware

Authorization decisions should never depend solely on roles.

The complete Context may influence the decision.

Examples include:

- Resource archived
- User suspended
- Visibility
- Ownership
- Verification
- Platform Administrator
- Future subscription level
- Future feature flags

Because authorization evaluates Context rather than only Roles, the architecture naturally adapts as new requirements emerge.

---

# Guiding Principle

Roles describe identity within a resource.

Capabilities describe what those roles permit.

Actions describe what is being attempted.

Abilities describe what the current actor may do.

Keeping these concepts separate allows the authorization subsystem to remain expressive, maintainable, and easy to evolve.

---

# Context

The Context is one of the most important concepts within Kizunia's authorization architecture.

Every authorization decision is evaluated against a Context.

The Context represents **everything the Authorizer needs to make a decision**.

Instead of asking:

> Can user `123` edit project `456`?

the Authorizer asks:

> Given this complete Context, is the requested action allowed?

This distinction is fundamental to the architecture.

---

# Why Context Exists

Consider the following authorization method.

```ts
authorize.project.edit(projectId, userId)
```

At first glance this appears sufficient.

However, the Authorizer immediately encounters several questions.

- Is the project archived?
- Is the user the owner?
- Is the user a maintainer?
- Is the user suspended?
- Is the project private?
- Is the user a Platform Administrator?
- Is the project locked?
- Is ownership currently being transferred?

The Authorizer now needs to execute multiple database queries.

Authorization becomes tightly coupled to persistence.

Instead, Kizunia introduces Context.

The Authorizer receives every required piece of information before evaluation begins.

---

# What A Context Contains

A Context contains every piece of information required to evaluate authorization.

For example:

```ts
ProjectContext
```

may contain

```ts
{
    actor,

    project,

    membership,

    platformRole,

    ownership,

    verification,

    visibility
}
```

Notice something important.

A Context contains **information**, not behavior.

It should never expose methods such as

```ts
context.save()

context.update()

context.delete()
```

Context objects are immutable representations of the current request.

---

# Context Is Not A Prisma Model

One of the biggest architectural decisions is that Context is **not** a database model.

For example

```ts
Project
```

is a Prisma model.

A Context is not.

Instead

```ts
ProjectContext
```

contains only the information required by the authorization subsystem.

This allows the authorization layer to remain completely independent from Prisma.

---

# Context Is Not A DTO

A common misunderstanding is treating Context as another DTO.

They are fundamentally different.

A DTO exists to move data between layers.

A Context exists to evaluate authorization.

These responsibilities should never be mixed.

---

# Context Is Not A Resource

Another common misunderstanding is treating the Resource itself as the Context.

For example

```ts
Project
```

is not enough.

Authorization may also require:

- Membership
- Platform Role
- Ownership
- Verification
- Visibility

The Resource is only one part of the Context.

---

# Context Resolver

Contexts are produced by Context Resolvers.

Example

```ts
ProjectContextResolver
```

The resolver gathers every piece of information required for authorization.

Its responsibilities include:

- Loading the resource
- Loading memberships
- Determining ownership
- Determining platform roles
- Resolving verification
- Preparing authorization metadata

The resolver returns one fully constructed Context.

---

# Why Context Resolvers Exist

Without Context Resolvers every Authorizer would repeatedly execute the same queries.

Example

```
Edit Project

↓

Load Membership

↓

Load Project

↓

Load Platform Role
```

Now imagine another permission.

```
Delete Project

↓

Load Membership

↓

Load Project

↓

Load Platform Role
```

The same work is repeated.

Context Resolvers eliminate this duplication.

Everything is loaded once.

Everything is reused.

---

# Context Resolution Lifecycle

```
HTTP Request

↓

Authentication

↓

ProjectContextResolver

↓

ProjectContext

↓

ProjectAuthorizer

↓

Authorization Decision
```

The Context is constructed exactly once.

After that point every authorization decision becomes a pure evaluation.

---

# Context Is Immutable

After creation, a Context should never be modified.

For example

```ts
context.membership.role = "OWNER"
```

should never happen.

If authorization state changes, a new Context should be constructed.

Immutability guarantees deterministic authorization.

---

# Context Is Request Scoped

Contexts only exist for a single request.

They are not cached globally.

They are not shared between users.

Every request receives a fresh Context representing the current state of the system.

This ensures authorization always evaluates the latest data.

---

# Context Enables Pure Authorizers

Because the Context already contains everything required, the Authorizer becomes a pure function.

Example

```ts
ProjectAuthorizer.edit(context)
```

The Authorizer:

- does not query Prisma
- does not call Better Auth
- does not call external APIs
- does not mutate data

It simply evaluates the Context.

This dramatically improves:

- Testability
- Predictability
- Maintainability
- Performance

---

# Context Enables Shared Authorization

Since Context is framework independent, exactly the same Authorizer can be executed by:

- Backend Controllers
- Server Actions
- React Server Components
- Client Components
- Future Mobile Applications
- CLI Tools
- Background Jobs

Only the Context changes.

The authorization logic never changes.

---

# Enterprise Benefits

The introduction of Context provides several long-term advantages.

## Separation of Concerns

Every layer owns exactly one responsibility.

- Controller → HTTP
- Resolver → Context construction
- Authorizer → Permission evaluation
- Service → Business logic
- Repository → Persistence

---

## Performance

Data required for authorization is loaded once.

Subsequent authorization checks reuse the same Context.

---

## Testability

Authorizers can be tested without:

- Database
- HTTP
- Better Auth
- Controllers
- Services

A unit test simply constructs a Context.

---

## Extensibility

Suppose future authorization depends on:

- Subscription Plans
- Premium Features
- Organization Membership
- Feature Flags
- Temporary Access Tokens

The Context expands.

The Authorizer API remains unchanged.

This is one of the strongest advantages of Context-driven authorization.

---

# Example

Instead of

```ts
authorize.project.edit(projectId, userId)
```

Kizunia evaluates

```ts
const context =
    await projectContextResolver.resolve({
        actorId,
        projectId
    });

const decision =
    authorize.project.edit(context);
```

The Authorizer receives a complete representation of the request.

It never needs to ask for additional information.

---

# Guiding Principle

A Context represents everything the Authorizer needs to know about the current request.

Nothing more.

Nothing less.

If an Authorizer requires additional information, the Context should evolve.

The Authorizer should not.

---

# Authorization Decisions

Every authorization request produces exactly one result.

This result is represented by an **Authorization Decision**.

Authorization Decisions are the only valid return type of an Authorizer.

For example:

```ts
const decision =
    authorize.project.edit(context);
```

The returned value is never:

```ts
true
```

or

```ts
false
```

Instead:

```ts
{
    allowed: true
}
```

or

```ts
{
    allowed: false,

    code: "NOT_PROJECT_OWNER",

    message:
        "Only project owners may edit this project."
}
```

Returning structured decisions instead of primitive values is one of the most important architectural decisions within Kizunia.

---

# Why Not Boolean?

A boolean only answers one question.

```
Allowed?
```

Yes.

No.

Unfortunately, real applications usually require much more information.

For example:

```
Why was it denied?

Should the frontend hide the button?

Should we disable the button?

Should we log this?

Should we audit this?

Should we display a tooltip?

Should we return HTTP 403?

Should we show an upgrade dialog?
```

A boolean cannot answer these questions.

---

# Decision Structure

Every Authorization Decision follows the same structure.

Example:

```ts
interface AuthorizationDecision {

    allowed: boolean;

    code?: string;

    message?: string;

}
```

Future versions may include additional metadata without changing the Authorizer API.

For example:

```ts
{

    allowed: false,

    code: "PROJECT_ARCHIVED",

    message:
        "Archived projects cannot be modified.",

    metadata: {

        archivedAt: ...

    }

}
```

The architecture intentionally leaves room for future expansion.

---

# Decision Codes

Decision codes are intended for machines.

Examples include:

```
NOT_MEMBER

NOT_OWNER

PROJECT_ARCHIVED

PROJECT_LOCKED

ACCOUNT_SUSPENDED

FEATURE_DISABLED

PLAN_REQUIRED
```

Decision codes should remain stable.

Applications may safely depend on them.

---

# Decision Messages

Messages are intended for humans.

Example:

```
Only project owners can archive this project.
```

Messages should never be used for application logic.

Only Decision Codes should be interpreted programmatically.

---

# Authorization Flow

```
Context

↓

Authorizer

↓

Authorization Decision

↓

Consumer
```

The consumer may be:

- Controller
- Server Action
- React Component
- Mobile Application
- Background Job

Every consumer receives exactly the same decision.

---

# Backend Usage

Controllers and Server Actions use Authorization Decisions to enforce security.

Example:

```ts
const decision =
    authorize.project.delete(context);

if (!decision.allowed) {

    throw new ForbiddenException(
        decision.message
    );

}
```

Business Services never receive unauthorized requests.

---

# Frontend Usage

The frontend may also evaluate authorization.

However, it never trusts itself.

Instead:

```ts
const decision =
    authorize.project.edit(context);
```

The UI may decide to:

- Hide a button
- Disable a button
- Display a tooltip
- Explain why an action is unavailable

Example:

```tsx
<Button

    disabled={!decision.allowed}

>

    Edit Project

</Button>
```

Notice that the frontend consumes the same Authorizer used by the backend.

---

# Decision Consistency

One of the primary goals of the architecture is consistency.

Regardless of whether authorization is evaluated by:

- Backend
- Frontend
- Mobile
- CLI

the same Context produces the same Authorization Decision.

There should never be multiple implementations of the same authorization rule.

---

# Future Expansion

Authorization Decisions intentionally leave room for future capabilities.

Examples include:

- Warning levels
- Required subscription plans
- Required verification
- Missing capabilities
- Required approvals
- Suggested actions

The public API remains unchanged.

Only the structure evolves.

---

# Guiding Principle

Authorizers never decide what the application should do.

They simply produce an Authorization Decision.

Consumers decide how to react.

This separation keeps the authorization subsystem independent of user interfaces, HTTP frameworks, and business logic.

---

# Frontend & Backend Integration

One of the primary goals of Kizunia's authorization architecture is to eliminate duplicated authorization logic.

Traditional applications often implement authorization separately on the frontend and backend.

For example:

```
Frontend

↓

if(role === "OWNER")

↓

Show Edit Button
```

while the backend performs:

```ts
if(member.role !== "OWNER") {
    throw ForbiddenException();
}
```

Although both implementations appear identical, they are completely independent.

As the application evolves, these implementations inevitably diverge.

One part of the application may allow a Maintainer to perform an action while another still requires an Owner.

This inconsistency creates confusing user experiences and introduces security risks.

Kizunia intentionally avoids this architecture.

---

# One Authorization System

The frontend and backend should never maintain separate authorization logic.

Instead, both consume the exact same Authorizer implementation.

```
                   ProjectAuthorizer
                  /                 \
                 /                   \
                ▼                     ▼

        Backend API            Frontend UI
```

There is only one source of truth.

Changing the authorization rules automatically updates every consumer.

---

# Frontend Responsibilities

The frontend is responsible only for improving user experience.

It should never be considered a security boundary.

Typical frontend responsibilities include:

- Showing actions
- Hiding actions
- Disabling actions
- Displaying explanations
- Improving discoverability

The frontend should never determine whether an operation is ultimately permitted.

That responsibility belongs exclusively to the backend.

---

# Backend Responsibilities

The backend is the final authority.

Every mutation must perform authorization before executing business logic.

Regardless of what the frontend displays, the backend evaluates authorization again.

For example:

```
Client

↓

Edit Project

↓

Backend

↓

ProjectAuthorizer

↓

Business Service

↓

Repository
```

Even if a malicious user manually modifies the frontend, backend authorization remains unchanged.

This guarantees platform security.

---

# Shared Authorizers

Because Kizunia uses TypeScript across the entire stack, the same Authorizer implementation can be shared between:

- Controllers
- Route Handlers
- Server Actions
- React Server Components
- Client Components
- Future Expo Application
- Future Desktop Application

No resource should maintain multiple authorization implementations.

---

# UI Rendering

One of the primary responsibilities of frontend authorization is rendering.

Instead of checking Roles:

```tsx
if(member.role === "OWNER")
```

components evaluate authorization.

```tsx
const decision =
    authorize.project.edit(context);

if(decision.allowed){

    ...

}
```

This immediately removes knowledge of:

- Roles
- Memberships
- Ownership
- Permission Sets

from UI components.

Components only understand authorization outcomes.

---

# Abilities

Although individual authorization methods work well for backend mutations, frontend rendering typically requires multiple authorization checks.

For example:

```
Project Page

↓

Edit

Delete

Archive

Transfer Ownership

Manage Members

Manage Media

Manage Links
```

Calling individual Authorizer methods for every button becomes repetitive.

Instead, every Authorizer exposes an Abilities method.

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

    delete: false,

    archive: true,

    transferOwnership: false,

    manageMembers: true,

    manageMedia: true,

    manageLinks: true

}
```

The frontend performs authorization once.

Every component consumes the resulting Abilities.

---

# Why Abilities Exist

Abilities provide several advantages.

## Cleaner Components

Instead of:

```tsx
authorize.project.edit(context)

authorize.project.delete(context)

authorize.project.archive(context)

authorize.project.transferOwnership(context)
```

components simply read:

```tsx
abilities.edit

abilities.delete

abilities.archive

abilities.transferOwnership
```

Rendering becomes declarative.

---

## Automatic Updates

Suppose Maintainers are now allowed to archive Projects.

Only the Authorizer changes.

Every page consuming:

```tsx
abilities.archive
```

automatically reflects the new permission model.

No component requires modification.

This dramatically reduces maintenance costs.

---

## Better Separation

Components no longer understand:

- Roles
- Permission Sets
- Membership Hierarchies

They only understand:

> Can the current user perform this action?

This keeps presentation independent from authorization implementation.

---

# Shared Context

The frontend and backend should evaluate authorization against equivalent Context objects.

For example:

```
Project

↓

Membership

↓

Platform Role

↓

Actor

↓

ProjectContext
```

The frontend does not require database access.

It simply evaluates the Context already received from the backend.

---

# Security

Sharing authorization logic does **not** mean trusting the frontend.

These are independent concerns.

Frontend authorization exists only for user experience.

Backend authorization exists for security.

Every mutation must always perform authorization again.

The following rule should never be violated.

> **Never trust the frontend.**

Even if the UI hides every protected action, the backend remains responsible for enforcing authorization.

---

# Example Lifecycle

A typical request follows the following sequence.

```
Backend

↓

Resolve Context

↓

ProjectAuthorizer

↓

Authorization Decision

↓

Business Service

↓

Response

↓

Frontend

↓

Reuse Context

↓

ProjectAuthorizer

↓

Abilities

↓

Render UI
```

Notice that both frontend and backend consume the same Authorizer.

Only their responsibilities differ.

---

# Future Platforms

Because the authorization system is framework independent, it naturally supports future platforms.

Examples include:

- Expo Mobile Application
- Desktop Application
- Browser Extension
- CLI Tools
- Public SDK

No authorization logic requires rewriting.

Only new consumers are introduced.

---

# Guiding Principle

Authorization should never be duplicated.

Every platform should consume the same Authorizer.

The backend enforces authorization.

The frontend visualizes authorization.

Together they provide a consistent, maintainable, and secure user experience.

---

# Enterprise Project Structure

The authorization subsystem is designed to integrate naturally into Kizunia's enterprise backend architecture.

The project intentionally follows a layered architecture where every layer owns exactly one responsibility.

```
HTTP Request
      │
      ▼
Route
      │
      ▼
Controller
      │
      ▼
Context Resolver
      │
      ▼
Authorizer
      │
      ▼
Service
      │
      ▼
Repository
      │
      ▼
Database
```

Although every request flows through the same layers, each layer solves a fundamentally different problem.

Keeping these responsibilities isolated significantly improves maintainability as the application grows.

---

# Enterprise Folder Structure

The following structure illustrates how the authorization subsystem integrates into the backend.

```
src/

├── modules/
│
│   ├── project/
│   │
│   ├── team/
│   │
│   ├── blog/
│   │
│   ├── hackathon/
│   │
│   └── ...
│
├── authorization/
│
│   ├── authorizers/
│   │
│   ├── contexts/
│   │
│   ├── resolvers/
│   │
│   ├── abilities/
│   │
│   ├── decisions/
│   │
│   ├── permission-sets/
│   │
│   └── shared/
│
└── shared/
```

Notice that authorization is **not** placed inside any individual module.

Authorization is treated as a platform subsystem rather than a Project subsystem.

Every resource simply contributes its own Authorizer and Context definitions.

---

# Layer Responsibilities

Each layer has a clearly defined responsibility.

## Route

Routes map incoming HTTP requests to Controllers.

Routes should never contain:

- Business Logic
- Authorization
- Database Queries

Their only responsibility is request routing.

---

## Controller

Controllers coordinate application flow.

Typical responsibilities include:

- Parsing requests
- Validating DTOs
- Invoking Context Resolvers
- Invoking Services
- Returning HTTP responses

Controllers should remain intentionally small.

They should contain almost no business logic.

---

## Context Resolver

Context Resolvers prepare everything required for authorization.

For example:

```
ProjectAuthorizationContextResolver
```

may:

- Load Project
- Load Membership
- Determine Ownership
- Determine Platform Role
- Resolve Verification
- Resolve Visibility

The resolver returns one complete Context.

No authorization occurs here.

---

## Authorizer

Authorizers evaluate authorization.

Given a Context:

```
ProjectContext
```

they answer questions such as:

```
Can Edit?

Can Delete?

Can Transfer Ownership?

Can Archive?
```

They never modify data.

They never communicate with external systems.

---

## Service

Services execute business logic.

Examples include:

- Updating project metadata
- Publishing blogs
- Creating hackathons
- Inviting team members

Services assume authorization has already succeeded.

They should never repeat permission checks.

---

## Repository

Repositories encapsulate persistence.

Repositories:

- Retrieve entities
- Persist entities
- Execute transactions

Repositories never contain:

- Authorization
- Validation
- Business Rules

---

# Typical Request Flow

The following sequence illustrates a complete request.

```
PATCH /projects/:id

        │

        ▼

ProjectController  (Authenticate → Validate)

        │

        ▼

ProjectService

        │

        ▼

ProjectAuthorizationContextResolver

        │

        ▼

ProjectContext

        │

        ▼

ProjectAuthorizer.edit()

        │

        ▼

AuthorizationDecision

        │

Allowed?

        │

  ┌─────┴─────┐

  ▼           ▼

No            Yes

│             │

403           ▼

     (Service business logic continues)

               │

               ▼

       ProjectRepository

               │

               ▼

            Database
```

Every resource follows this same lifecycle.

Consistency is preferred over resource-specific optimizations.

---

# Why Services Resolve Context And Authorize

A natural question is:

> Why doesn't the Controller build the Context and call the Authorizer?

Kizunia deliberately keeps the Controller as thin as possible — it only
authenticates the request and validates its shape. Context Resolution and
Authorization happen inside the Service instead, as the first two steps of
every mutating Service method, strictly before any business logic runs.

This provides several advantages.

- Controllers stay uniform across every module: Authenticate → Validate →
  call the Service. There is no per-endpoint decision about how much
  context-building belongs in the Controller.
- The Service frequently needs to load the same resource for both
  authorization and business logic (e.g. it must load the Project anyway
  to update it). Resolving context in the Service lets it reuse that
  already-loaded entity via the Context Resolver's `fromData(...)` variant,
  instead of the Controller and Service each querying independently.
- Authorization still fully completes — and the Decision is still asserted
  — before a single line of business logic executes. The *sequencing*
  guarantee ("unauthorized requests never reach business logic") is
  preserved; only the *layer* that performs the resolution and the check
  has moved.

The one invariant that does **not** change: Services must still never
invent their own authorization *rules*. They resolve a Context and defer
entirely to the Authorizer/Policy/PermissionSet for the actual decision.

---

# Why Context Resolvers Invoke Repositories

Context Resolvers require data.

Examples include:

- Project
- Membership
- Team
- Platform Role

Rather than querying Prisma directly, Resolvers communicate through Repositories.

This maintains architectural consistency.

```
Resolver

↓

Repository

↓

Database
```

This ensures every database interaction follows the same abstraction.

---

# Why Authorizers Are Still Never Invoked From Business Logic

Even though the Service is the layer that *calls* the Context Resolver and
Authorizer, it must do so only as a distinct first phase, before any
business logic runs:

```
Controller

↓

Service
   1. Context Resolver
   2. Authorizer   ← Authorization.assert(...) — throws if denied
   3. Business logic
   4. Repository
```

Kizunia rejects interleaving authorization checks *inside* business logic
(e.g. an `if (canEdit) { ... }` branch midway through a method, or a
Repository call gated by an ad-hoc role check). A Service method authorizes
once, up front, and everything after that point assumes the decision has
already been made.

This preserves the original guarantee this section used to describe under
a different layer split:

- Business logic becomes easier to test (it never has to be exercised
  through an authorization-failure path).
- Unauthorized requests never reach the persistence layer.
- The rule for "how" a decision is made stays entirely inside the
  Authorizer/Policy — Services only decide "when" to ask.

---

# Why Authorizers Never Invoke Repositories

Another common mistake is allowing Authorizers to fetch data.

Example:

```ts
ProjectAuthorizer.edit(projectId, actorId)
```

Internally:

```
Query Membership

↓

Query Project

↓

Query Team
```

This tightly couples authorization to persistence.

Instead:

```
Resolver

↓

ProjectContext

↓

Authorizer
```

The Authorizer becomes completely deterministic.

---

# Dependency Direction

Every dependency points downward.

```
Controller

↓

Resolver

↓

Repository
```

```
Controller

↓

Authorizer
```

```
Controller

↓

Service

↓

Repository
```

Notice something important.

Repositories never depend on Services.

Services never depend on Controllers.

Authorizers never depend on Repositories.

Maintaining one-way dependencies dramatically reduces coupling.

---

# Shared Components

Some authorization concepts are shared across every resource.

Examples include:

```
AuthorizationDecision

↓

Actor

↓

Platform Role

↓

Ability

↓

Permission Set
```

These shared concepts should live inside the authorization subsystem rather than inside individual modules.

This prevents duplication while maintaining consistency.

---

# Design Principles

The enterprise architecture follows several important principles.

## Explicitness

Every responsibility has a dedicated layer.

Nothing is implicit.

---

## Predictability

Every request follows the same lifecycle.

Contributors should never need to guess where authorization occurs.

---

## Testability

Every layer can be tested independently.

Controllers.

Resolvers.

Authorizers.

Services.

Repositories.

---

## Replaceability

Every layer may evolve independently.

Repositories may change.

Database may change.

Framework may change.

Authorization remains unchanged.

---

## Scalability

Adding new resources requires creating:

- Context
- Resolver
- Authorizer

The surrounding architecture remains identical.

As the platform grows, architectural complexity grows linearly rather than exponentially.

---

# Performance Considerations

The authorization architecture has been designed with performance as a first-class concern.

Authorization should remain inexpensive regardless of how many resources exist within the platform.

Several architectural decisions directly contribute to this goal.

## Single Context Resolution

Every request resolves its Authorization Context exactly once.

After the Context has been constructed, every authorization decision reuses the same data.

This avoids repeated database queries.

Instead of:

```
Authorizer

↓

Query Membership

↓

Query Project

↓

Query Platform Role
```

multiple times,

the system performs:

```
Context Resolver

↓

Load Everything Once

↓

Reuse Context Everywhere
```

This dramatically reduces unnecessary database access.

---

## Pure Authorizers

Authorizers are pure functions.

Given the same Context, they always produce the same Authorization Decision.

Because they have no side effects, they are:

- Extremely fast
- Easy to cache
- Easy to test
- Easy to reason about

---

## Shared Authorization

The same Authorizer implementation is shared across:

- Backend
- Frontend
- Server Actions
- Future Mobile Applications
- Future SDKs

This removes duplicate implementations while guaranteeing consistent authorization behavior across every platform.

---

# Testing Philosophy

Every layer of the authorization architecture should be independently testable.

## Context Resolver Tests

Verify that the resolver constructs the correct Context.

Example:

- Membership loaded correctly
- Ownership resolved correctly
- Platform Role resolved correctly

---

## Authorizer Tests

Authorizers should be tested without:

- Database
- HTTP
- Better Auth
- Controllers
- Services

Every test simply constructs a Context and evaluates an action.

Example:

```ts
const decision =
    authorize.project.edit(context);

expect(decision.allowed).toBe(true);
```

These tests should execute in milliseconds.

---

## Integration Tests

Integration tests verify that every layer communicates correctly.

Typical flow:

```
Controller

↓

Resolver

↓

Authorizer

↓

Service

↓

Repository
```

The goal is not to retest authorization rules, but to verify correct orchestration.

---

# Future Evolution

Although the current authorization architecture is intentionally simple, it has been designed to evolve naturally as Kizunia grows.

Potential future enhancements include:

- Organization support
- Feature Flags
- Premium Features
- Subscription-aware authorization
- Temporary Permissions
- Time-limited Access
- Public API Keys
- AI-assisted moderation
- Marketplace permissions
- External Integrations

These additions should extend the existing architecture rather than replace it.

The fundamental flow remains unchanged.

```
Resolve Context

↓

Evaluate Authorization

↓

Execute Business Logic
```

---

# Architectural Decisions

The following decisions have been intentionally made for Kizunia.

## Authentication

Authentication is delegated entirely to Better Auth.

Kizunia never reimplements authentication.

---

## Authorization

Authorization is implemented entirely by Kizunia.

Resource-specific authorization rules remain under complete application control.

---

## Context Driven

Every authorization decision evaluates a Context rather than individual identifiers.

---

## Explicit Authorizers

Every resource owns its own Authorizer.

Examples:

- ProjectAuthorizer
- TeamAuthorizer
- BlogAuthorizer
- HackathonAuthorizer

---

## Resource-Oriented Design

Authorization is organized around resources rather than routes.

---

## Shared Authorization

Frontend and Backend consume the same Authorizers.

---

## Backend Is Always Trusted

Frontend authorization exists purely for user experience.

Every mutation is re-authorized on the backend.

---

## Pure Authorizers

Authorizers never:

- Query databases
- Execute business logic
- Modify state

They only evaluate authorization.

---

## Explicit Layers

Every layer owns exactly one responsibility.

No layer should assume responsibilities belonging to another.

---

## Documentation First

Architectural changes must be documented before implementation.

Documentation remains the source of truth.

---

# Architecture Summary

The authorization subsystem can be summarized by a single diagram.

```
                        User Request
                              │
                              ▼
                    Authentication
                     (Better Auth)
                              │
                              ▼
                 Authorization Context Resolver
                              │
                              ▼
                    Authorization Context
                              │
                              ▼
                         Authorizer
                              │
                              ▼
                  Authorization Decision
                     │                 │
                     ▼                 ▼
             Frontend UI        Business Service
                                        │
                                        ▼
                                   Repository
                                        │
                                        ▼
                                     Database
```

Every request follows this lifecycle.

Every resource follows the same architectural principles.

Every authorization decision originates from an Authorizer.

Every business operation executes only after authorization succeeds.

This consistency is the primary strength of the architecture.

---

# Final Principles

The following principles summarize the philosophy of Kizunia's authorization architecture.

- Authorization is centralized.
- Authentication and Authorization are separate concerns.
- Authorization and Business Logic are separate concerns.
- Frontend improves user experience.
- Backend guarantees security.
- Contexts contain information.
- Authorizers evaluate information.
- Services execute business logic.
- Repositories persist data.
- Every layer owns exactly one responsibility.
- Every authorization decision is deterministic.
- Every resource owns its own authorization rules.
- Documentation evolves before implementation.

These principles should guide every future contribution to the authorization subsystem.

---

# Closing Notes

Authorization is not a feature.

It is infrastructure.

A well-designed authorization system allows every future feature to be implemented consistently without introducing duplicated permission logic or architectural debt.

This document defines the architectural foundation upon which all authorization within Kizunia should be built.

Future implementations should conform to the architecture described here unless an explicit architectural decision supersedes it.
