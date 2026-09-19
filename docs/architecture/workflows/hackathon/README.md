# Hackathon Workflows

## Purpose

This directory documents every workflow related to the Hackathon module within **Kizunia Web**.

Unlike the domain model, which describes what a Hackathon is, these documents describe **how hackathon-related processes behave** throughout the platform.

The goal is to establish a single source of truth for user interactions, moderation, review processes, lifecycle management, and other behavioral aspects of the Hackathon module before implementation begins.

These documents intentionally avoid framework-specific implementation details while remaining detailed enough to guide backend, frontend, and database design.

---

# Why Workflow Documentation?

A domain model answers questions such as:

- What information does a hackathon contain?
- Who owns a hackathon?
- What relationships does it have?

A workflow answers different questions:

- How does a community member suggest a hackathon?
- How are duplicate submissions prevented?
- How does an administrator review a submission?
- What happens when changes are requested?
- How does a proposal become a published hackathon?

Separating workflows from domain models keeps the documentation modular and significantly easier to maintain as the platform evolves.

---

# Design Philosophy

Every workflow should follow the core principles of Kizunia Web.

Specifically:

- Keep the barrier to contribution as low as possible.
- Encourage community participation.
- Protect the quality of published information.
- Minimize administrative effort.
- Preserve flexibility for future improvements.
- Keep workflows understandable and predictable.

The platform should remain community-driven while ensuring that published hackathon information is trustworthy.

---

# Scope

This directory currently focuses on the complete lifecycle of community-contributed hackathons.

Topics include:

- Suggesting a hackathon
- Duplicate detection
- Draft management
- Review workflow
- Publication workflow
- Hackathon lifecycle
- Technical design decisions

Future versions may also document workflows for:

- Community edit suggestions
- Organizer edit access
- Verification requests
- Community moderation
- Automated duplicate detection improvements

These topics will only be documented after their designs have been finalized.

---

# Workflow Structure

Each workflow document follows a consistent structure whenever applicable.

Typical sections include:

- Purpose
- Actors
- Goals
- Workflow
- State Transitions
- Design Decisions
- Edge Cases
- Technical Considerations
- Future Improvements

Not every workflow requires every section, but consistency should be maintained wherever possible.

---

# Reading Order

For the best understanding of the Hackathon module, read the documents in the following order.

| Order | Document | Description |
|-------|----------|-------------|
| 1 | `suggestion-workflow.md` | Complete workflow for suggesting a new hackathon. |
| 2 | `duplicate-detection.md` | Duplicate detection strategy and user experience. |
| 3 | `review-workflow.md` | Administrative review process for community submissions. |
| 4 | `lifecycle.md` | State machines used throughout the Hackathon module. |
| 5 | `technical-design.md` | Technical architecture and implementation decisions. |

---

# Relationship to Other Documentation

This directory complements other documentation within the project.

| Directory | Responsibility |
|------------|----------------|
| `project/` | Product vision and feature planning |
| `architecture/domain/` | Domain models and business entities |
| `architecture/authorization/` | Roles and permissions |
| `architecture/workflows/` | Behavioral workflows and state transitions |

Each documentation area should remain focused on its own responsibility.

---

# Guiding Principles

When designing or modifying a workflow, ask the following questions:

- Does this reduce friction for builders?
- Does this maintain the quality of published information?
- Does this minimize unnecessary work for administrators?
- Does this keep the platform community-driven?
- Can the workflow evolve without major redesign?

If the answer to most of these questions is "yes", the workflow likely aligns with the goals of Kizunia Web.

---

# Documentation Philosophy

Workflow documentation records behavior rather than implementation.

These documents should describe:

- what happens,
- why it happens,
- who is involved,
- and how different parts of the platform interact.

They should not contain:

- Database schemas
- API endpoints
- Framework-specific code
- UI implementation details

Those topics belong elsewhere in the architecture documentation.

---

# Status

The Hackathon workflow documentation is considered a living specification.

As new workflows are designed and accepted into the platform, they should be documented here before implementation begins.

Every workflow should reflect the current architecture of Kizunia Web and remain consistent with the project's core principles and long-term vision.