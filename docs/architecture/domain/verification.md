# Verification

> **Status:** Stable
>
> **Version:** 1.0
>
> **Referenced By:** Users, Projects, Teams, Hackathons
>
> **Last Updated:** 2026-07-18

---

# Purpose

The Verification model represents trust issued by the Kizunia platform.

Verification confirms authenticity.

It does **not** represent popularity, reputation, or quality.

A verification badge simply tells users that Kizunia has verified some aspect of an entity.

---

# Design Philosophy

Verification exists to build trust.

Badges should be meaningful.

Every verification must answer a clear question.

Examples:

- Is this really the platform owner?
- Is this hackathon officially maintained?
- Is this project officially verified?
- Is this user an organizer?

If a badge cannot clearly communicate trust, it should not exist.

---

# Responsibilities

The Verification model is responsible for:

- Badge type
- Verification reason
- Verification date
- Verification issuer

It is **not** responsible for:

- Permissions
- Roles
- Popularity
- Ranking

---

# Fields

| Field | Required | Description |
|--------|----------|-------------|
| id | Yes | Primary identifier |
| type | Yes | Verification badge type |
| verifiedAt | Yes | Verification timestamp |
| issuedBy | Yes | Platform administrator who granted verification |
| note | No | Optional internal reason |

---

# Badge Types

Each verification represents one trust relationship.

Examples include:

## Platform

- Platform Owner
- Platform Administrator

---

## User

- Verified Builder
- Verified Organizer

---

## Team

- Verified Team
- Official College Club

---

## Project

- Verified Project
- Official Submission

---

## Hackathon

- Official Hackathon
- Verified Organizer

Future badge types may be introduced without changing the architecture.

---

# Relationships

A verification belongs to exactly one entity.

Supported entities include:

- User
- Project
- Team
- Hackathon

An entity may possess multiple verification badges.

---

# Issuer

Every verification is granted by the platform.

The issuer should always be a Kizunia administrator.

This provides accountability and allows future audit logs.

---

# Display

Verification badges should be displayed consistently throughout the platform.

Examples:

- Profile page
- Project page
- Team page
- Hackathon page

Badges should also expose a short description explaining their meaning.

---

# Revocation

Verification may be revoked.

Revoking a verification removes the badge but does not delete the underlying entity.

Historical audit information should remain available internally.

---

# Design Decisions

## Why a Separate Model?

Verification is a reusable concept.

Embedding boolean fields such as:

- isVerified
- isOfficial

inside every entity would quickly become difficult to maintain.

A reusable Verification model keeps the platform flexible.

---

## Why Multiple Badges?

A user may be both:

- Platform Administrator
- Verified Organizer

Likewise, a hackathon may be:

- Official Hackathon
- Community Verified

Supporting multiple badges avoids artificial limitations.

---

## Why Platform Issued?

Verification exists to establish trust.

Only trusted platform administrators should issue verification badges.

This preserves the credibility of the system.

---

# Future Expansion

Potential future capabilities include:

- Verification expiration
- Public verification history
- Verification requests
- Automatic organizer verification

These features should extend the Verification model without changing its core philosophy.

---

# Guiding Principle

The Verification model should answer one question:

> **Why should builders trust this entity?**

It should never become a measure of popularity or influence.

Verification exists solely to communicate authenticity and platform trust.