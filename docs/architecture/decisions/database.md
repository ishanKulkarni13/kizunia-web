# Database

## Status

Accepted

---

# Context

Kizunia manages highly connected data including:

- Users
- Teams
- Projects
- Hackathons
- Blogs
- Relationships

The platform requires strong relational integrity.

---

# Decision

Kizunia will use **PostgreSQL** with **Prisma ORM**.

The database will be designed using a relational model.

---

# Rationale

The platform contains many relationships and many-to-many associations.

A relational database provides consistency, strong constraints and predictable querying.

Prisma offers excellent developer experience while remaining database agnostic.

---

# Design Principles

- Normalize data where practical.
- Prefer explicit relations.
- Avoid duplicate information.
- Keep schemas simple.
- Optimize for readability before optimization.

---

# Consequences

## Advantages

- Strong relational modeling.
- Excellent Prisma ecosystem.
- Easy migrations.
- Type-safe database access.

## Trade-offs

- Requires schema migrations.
- More structured than NoSQL solutions.