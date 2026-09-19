# Team

> **Status:** Stable
>
> **Version:** 1.0
>
> **Referenced By:** Users, Projects, Hackathons, Portfolios
>
> **Last Updated:** 2026-07-18

---

# Purpose

The Team model represents a collaborative group of builders.

Teams exist to enable collaboration on one or more engineering projects.

Unlike projects, which represent engineering work, teams represent people working together.

A team may participate in hackathons, build personal projects, contribute to open-source software, or simply exist as a long-term group.

---

# Design Philosophy

Teams represent collaboration.

They are intentionally independent from projects and hackathons.

A team should remain valid even if:

- it has no projects,
- it has never participated in a hackathon,
- it only contains one member,
- it becomes inactive.

This flexibility allows Kizunia to support both temporary hackathon teams and long-term engineering communities.

---

# Responsibilities

The Team model is responsible for:

- Team identity
- Public metadata
- Membership
- Team documentation
- Media
- External links
- Visibility
- Verification

The Team model is **not** responsible for:

- Project ownership
- User profiles
- Hackathon management
- Portfolio customization

---

# Identity

Identity uniquely defines a team.

| Field | Required | Unique | Description |
|--------|----------|--------|-------------|
| id | Yes | Yes | Primary identifier. |
| name | Yes | No | Public team name. |
| slug | Yes | Yes | Human-readable URL identifier. |
| shortDescription | Yes | No | Short summary of the team. |

---

# Slug

Team URLs follow the format:

```
/teams/{slug}
```

Examples:

```
/teams/byteforce

/teams/kizunia-core

/teams/vision-builders
```

## Rules

- Unique
- Editable
- Lowercase
- Letters
- Numbers
- Hyphen
- Reserved slugs prohibited

---

# Metadata

Metadata describes the team.

| Field | Required | Description |
|--------|----------|-------------|
| visibility | Yes | Public / Unlisted / Private |
| status | Yes | Active / Recruiting / Inactive |
| verification | No | Relationship to Verification |
| createdAt | Yes | Creation timestamp |
| updatedAt | Yes | Last modification timestamp |

---

# Documentation

Every team owns exactly one documentation page.

Documentation is stored as Markdown / MDX.

Examples include:

- Team introduction
- Goals
- Vision
- Working style
- Recruitment information
- Previous achievements
- Contact information

Structured information should never be duplicated inside documentation.

---

# Media

Teams support reusable media.

Examples include:

- Banner
- Logo
- Gallery

Media is represented using the reusable Media entity.

---

# Links

Teams support multiple external links.

Examples include:

- GitHub Organization
- Discord
- Website
- LinkedIn
- Devpost

Links are represented using the reusable Link entity.

---

# Membership

Membership is represented through the TeamMember relationship.

Each user has exactly one role within a team.

Possible roles include:

- Owner
- Maintainer
- Member

---

# Owner

Owners have complete control.

Examples:

- Edit team
- Delete team
- Manage permissions
- Transfer ownership
- Manage maintainers
- Manage recruitment

---

# Maintainer

Maintainers assist in managing the team.

Examples:

- Edit team information
- Edit documentation
- Manage members
- Review join requests

Maintainers cannot transfer ownership or delete the team.

---

# Member

Members belong to the team.

They appear publicly on the team page.

Members cannot modify team metadata unless granted a higher role.

---

# Projects Relationship

A team may own multiple projects.

Projects remain independent entities.

Removing a project from a team should never delete the project.

Similarly, deleting a team should not delete its projects.

Ownership of projects is managed independently through ProjectMember.

---

# Hackathon Relationship

Teams may participate in multiple hackathons.

Participation does not imply ownership of the hackathon.

Hackathon participation should be represented through relationships rather than embedded data.

---

# Recruitment

Teams may optionally recruit new members.

Recruitment status is represented through the team status and future recruitment settings.

Examples include:

- Recruiting
- Closed

Future versions may support role-specific recruitment.

---

# Verification

Teams may receive verification.

Examples include:

- Verified Team
- Official Club
- Official Community

Verification confirms authenticity rather than popularity.

---

# Visibility

Teams support three visibility levels.

- Public
- Unlisted
- Private

Visibility affects discoverability but not membership permissions.

---

# Search

Teams should be searchable using structured metadata.

Examples include:

- Name
- Technologies (through projects)
- Categories (through projects)
- Members
- Status

Documentation should not be relied upon as the primary search source.

---

# Design Decisions

## Why TeamMember?

Membership is represented through a dedicated TeamMember relationship.

Each user has exactly one role within a team.

This avoids duplicate ownership arrays and simplifies permission management.

---

## Why Separate Projects?

Teams collaborate on projects.

They do not own the definition of a project.

Projects remain first-class entities that can exist independently.

---

## Why Separate Documentation?

Long-form information should remain flexible.

Structured metadata should remain queryable.

Keeping these concerns separate produces a cleaner schema and editor experience.

---

## Why Optional Hackathons?

Hackathons are opportunities.

Teams are long-lived collaborative groups.

A team should continue to exist after a hackathon ends.

---

# Future Expansion

Potential future capabilities include:

- Recruitment roles
- Team invitations
- Join requests
- Team achievements
- Activity timeline
- Team analytics

These additions should extend the Team model without changing its core philosophy.

---

# Guiding Principle

The Team model should answer one question:

> **Who collaborates together?**

It should never attempt to answer:

> **What was built?**

That responsibility belongs to Projects.

Likewise, it should never attempt to answer:

> **Which event hosted the project?**

That responsibility belongs to Hackathons.