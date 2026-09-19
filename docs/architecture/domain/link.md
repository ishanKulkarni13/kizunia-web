# Link

> **Status:** Stable
>
> **Version:** 1.0
>
> **Referenced By:** Users, Projects, Teams, Hackathons, Blogs
>
> **Last Updated:** 2026-07-18

---

# Purpose

The Link model represents an external resource associated with another entity.

Links provide a flexible and reusable way to reference external websites, repositories, videos, applications, documentation, communities, and other online resources.

Instead of creating dedicated URL fields for every possible service, Kizunia models them through a single reusable entity.

---

# Design Philosophy

A link represents a destination.

It should not assume the destination belongs to a specific platform.

New services appear constantly.

The Link model should allow the platform to support new destinations without requiring database changes.

---

# Responsibilities

The Link model is responsible for:

- External URLs
- Link labels
- Link ordering
- Link type
- Link icon

The Link model is **not** responsible for:

- Uploading files
- Hosting content
- Media storage

---

# Fields

| Field | Required | Description |
|--------|----------|-------------|
| id | Yes | Primary identifier |
| label | Yes | Human readable name |
| url | Yes | Destination URL |
| type | Yes | Type of link |
| icon | No | Optional custom icon |
| order | Yes | Display order |
| createdAt | Yes | Creation timestamp |
| updatedAt | Yes | Last modification timestamp |

---

# Type

The type describes the destination.

Examples include:

- Website
- GitHub
- GitLab
- Bitbucket
- Documentation
- YouTube
- Google Drive
- Figma
- Devpost
- Discord
- LinkedIn
- X
- Play Store
- App Store
- Research Paper

The platform should support adding new types without schema changes.

---

# Label

Labels describe the destination to users.

Examples:

- Live Demo
- GitHub Repository
- Design
- Backend Repository
- API Documentation
- Rulebook
- Registration

Labels are user-defined.

---

# Icon

Links may optionally specify an icon.

Icons improve recognition and visual consistency.

If no custom icon is provided, the platform should automatically choose an icon based on the link type.

---

# Ordering

Links support manual ordering.

Example:

1. Live Demo
2. GitHub
3. Documentation
4. Figma
5. Discord

Ordering allows builders to prioritize important resources.

---

# Relationships

Links may belong to:

- User
- Project
- Team
- Hackathon
- Blog

A link belongs to exactly one parent entity.

---

# Validation

URLs should:

- use HTTPS whenever possible
- be valid URLs
- reject unsupported protocols
- remove unnecessary whitespace

Platform-specific validation may be added later.

Examples:

GitHub

```
https://github.com/owner/repository
```

YouTube

```
https://youtu.be/...
```

Google Drive

```
https://drive.google.com/...
```

---

# Design Decisions

## Why Separate Links?

Without the Link model, every entity would require numerous nullable fields.

For example:

- githubUrl
- websiteUrl
- youtubeUrl
- discordUrl
- figmaUrl

This quickly becomes difficult to maintain.

The Link model solves this with a single reusable relationship.

---

## Why Labels?

The same URL type can serve different purposes.

For example:

GitHub

- Frontend Repository
- Backend Repository
- Mobile App

Labels provide important context.

---

## Why Order?

Not every link has equal importance.

Builders should decide what visitors see first.

---

# Future Expansion

Potential future capabilities include:

- Link analytics
- Click counts
- Automatic previews
- Health checks
- Broken link detection
- Rich embeds

These features should extend the Link model without changing its core design.

---

# Guiding Principle

The Link model should answer one question:

> **Where can someone learn more or interact with this entity?**

It should remain lightweight, reusable, and independent of any specific platform.