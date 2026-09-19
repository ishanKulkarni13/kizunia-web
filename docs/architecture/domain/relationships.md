# Relationships

> **Status:** Stable
>
> **Version:** 1.0
>
> **Referenced By:** Users, Projects, Teams, Hackathons, Blogs, Portfolios
>
> **Last Updated:** 2026-07-18

---

# Purpose

Relationships define how entities are connected throughout Kizunia.

Unlike standalone entities such as Projects or Teams, relationship models represent interactions, ownership, membership, and participation between entities.

Relationship models exist to keep the domain normalized while preserving clear business rules.

---

# Design Philosophy

Relationships should model the real world.

Whenever an entity can have multiple users with different responsibilities, Kizunia models those users through relationship entities instead of embedding multiple ownership fields.

For example, instead of:

```
Project

owners[]
maintainers[]
contributors[]
```

Kizunia uses:

```
Project
        │
        ▼
ProjectMember
```

This approach provides a single source of truth for permissions and membership.

---

# Guiding Principles

## One Role Per Entity

A user may have only one role within a particular entity.

For example, inside a single project a builder cannot simultaneously be both an Owner and a Contributor.

Their highest applicable role should always be stored.

---

## Relationships Own Permissions

Permissions are determined through relationships rather than individual entity fields.

Examples:

- Can edit a project?
- Can transfer ownership?
- Can edit documentation?
- Can remove members?

These permissions are derived from relationship roles.

---

## Relationships Are Independent

Projects, Teams, Hackathons and other entities remain independent.

Relationships connect them without changing ownership.

Deleting a relationship should never delete the related entities.

---

# ProjectMember

## Purpose

Represents a user's participation within a Project.

Every user connected to a project has exactly one ProjectMember record.

---

## Fields

| Field | Description |
|--------|-------------|
| projectId | Associated project |
| userId | Associated user |
| role | User's role within the project |
| joinedAt | Date the user joined the project |

---

## Roles

### Owner

Full control.

Examples:

- Edit project
- Delete project
- Manage permissions
- Transfer ownership
- Manage maintainers

---

### Maintainer

Can manage the project but cannot transfer ownership.

Examples:

- Edit metadata
- Edit documentation
- Manage contributors

---

### Contributor

Represents a builder who contributed to the project.

Contributors appear publicly but cannot manage project settings.

---

# TeamMember

## Purpose

Represents membership within a Team.

Every user connected to a team has exactly one TeamMember record.

---

## Fields

| Field | Description |
|--------|-------------|
| teamId | Associated team |
| userId | Associated user |
| role | User's role within the team |
| joinedAt | Date the user joined the team |

---

## Roles

### Owner

Full administrative control.

Examples:

- Manage members
- Transfer ownership
- Delete team
- Manage maintainers

---

### Maintainer

Can help manage the team.

Examples:

- Edit information
- Edit documentation
- Manage members

---

### Member

Regular team member.

Appears publicly on the team page.

Cannot modify team information.

---

# Ownership Model

Ownership is intentionally relationship-based.

Projects, Teams and future collaborative entities should never contain dedicated owner arrays.

Instead, ownership should always be determined through relationship records.

This ensures a consistent permission model throughout the platform.

---

# Future Relationship Models

Future versions of Kizunia may introduce additional relationship entities.

Examples include:

- Project ↔ Hackathon
- User ↔ Hackathon (Bookmarks)
- Portfolio ↔ Featured Project
- Portfolio ↔ Featured Blog
- Portfolio ↔ Featured Team

These should follow the same design principles described in this document.

---

# Design Decisions

## Why Relationship Models?

Relationship models eliminate duplicate ownership fields and simplify authorization.

They also make future permission changes significantly easier.

---

## Why One Role?

Allowing multiple simultaneous roles creates ambiguity.

A single role keeps permission checks simple and predictable.

---

## Why Separate ProjectMember and TeamMember?

Although both models appear similar, they represent different business concepts.

Projects and Teams evolve independently and may require different metadata in the future.

Keeping them separate avoids premature abstraction while preserving flexibility.

---

# Future Expansion

Potential future additions include:

- Invitation status
- Join requests
- Contribution summaries
- Last active timestamps
- Role history
- Ownership transfer history

These should extend the relationship models without changing their core philosophy.

---

# Guiding Principle

Relationship models should answer one question:

> **How are these entities connected?**

They should never duplicate information already owned by the entities themselves.

Instead, they define collaboration, ownership, and permissions in a clear, consistent, and reusable manner.