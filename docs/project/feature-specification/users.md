# Users

## Purpose

The User module represents every individual who interacts with Kizunia Web.

Every authenticated person on the platform is represented as a user.

Unlike traditional social platforms, a Kizunia user is not defined by followers, posts, or social activity.

Instead, a user is defined by the projects they build, the teams they collaborate with, and the hackathons they participate in.

The user profile serves as the foundation of the user's engineering identity.

---

# Philosophy

Kizunia is a builder-first platform.

Users should spend their time creating meaningful projects rather than maintaining profiles.

Whenever possible, the platform should automatically generate information from the user's activity.

A profile should become richer as the user contributes to the ecosystem.

---

# Responsibilities

The User module is responsible for:

* Identity
* Authentication
* Public profile
* Engineering portfolio
* Ownership
* Collaboration
* Verification
* Notification preferences

The User module should never be responsible for storing project-specific or hackathon-specific information.

Instead, it references those entities through relationships.

---

# Authentication

Authentication is handled by Better Auth.

Supported providers include:

* Google
* GitHub

Future authentication providers may be introduced if required.

Authentication is intentionally separated from the rest of the user profile.

---

# Profile

Every user has one public profile.

The profile represents the user's engineering identity.

A profile may include, but is not limited to:

* Name
* Username
* Profile Picture
* Cover Image
* Bio
* College
* Degree
* Graduation Year
* Skills
* Interests
* Location
* GitHub
* LinkedIn
* Portfolio Website
* Contact Information (optional)

Future profile fields may be introduced without changing the core design.

---

# Engineering Portfolio

The portfolio is automatically generated from user activity.

Rather than manually adding achievements, Kizunia builds the portfolio from:

* Projects
* Teams
* Hackathons
* Contributions
* Achievements

Users may customize how this information is presented, but the underlying data is generated from platform activity whenever possible.

---

# Relationships

A user may:

* Own multiple projects.
* Maintain multiple projects.
* Contribute to multiple projects.
* Own multiple teams.
* Join multiple teams.
* Participate in multiple hackathons.
* Receive personalized notifications.

No relationship should be unnecessarily restricted.

---

# Ownership

Ownership represents ultimate control over an entity.

Owners may:

* Edit
* Delete
* Archive
* Transfer ownership
* Manage maintainers

An entity may support multiple owners where appropriate.

Ownership should always be explicit.

---

# Maintainers

Maintainers are trusted collaborators.

Unlike owners, maintainers cannot transfer ownership or permanently remove the entity.

Maintainers may update information, documentation, media, and other editable content depending on the entity.

Different entities may expose different maintainer capabilities.

---

# Contributors

Contributors are publicly credited for their work.

Being listed as a contributor does **not** automatically grant editing permissions.

Contribution and maintenance are intentionally treated as separate concepts.

This allows users to receive recognition without unintentionally granting administrative privileges.

---

# Verification

Verification establishes trust within the platform.

Unlike traditional social media verification, Kizunia verification indicates why a user is trusted.

Verification badges are contextual and should always represent a meaningful relationship with the platform or a specific entity.

Examples include:

* Kizunia Owner
* Kizunia Administrator
* Verified Organizer
* Verified Project Owner

Additional verification types may be introduced as the platform evolves.

Verification should never be treated as a popularity metric.

Its purpose is to establish authenticity and improve trust.

---

# Privacy

Users should control the visibility of their information.

Where appropriate, fields may support:

* Public
* Private
* Hidden

Future versions may introduce more granular privacy settings.

---

# Discovery

Users should be discoverable through meaningful engineering information rather than social metrics.

Examples include:

* Skills
* Projects (which surface the technologies used, via `ProjectTechnology`)
* Portfolio (which surfaces the technologies the user intentionally presents, via `PortfolioTechnology` — see [`technology.md`](../../architecture/domain/technology.md))
* Hackathons
* Teams

Technology is not a direct User relationship — discovery by technology goes through what a user's Projects and Portfolio present, not a User-level technology field.

The platform should prioritize helping users discover collaborators rather than encouraging follower counts or engagement statistics.

---

# Notification Preferences

Every user may configure notification preferences.

Examples include:

* Categories
* Locations
* Online or offline hackathons
* Student eligibility
* Reminder preferences

A technology-based preference ("preferred technologies") is not implemented — no `UserTechnologyNotificationPreference` model or equivalent code exists. Technology-aware notification/recommendation preferences are explicit future work; see [`technology.md`](../../architecture/domain/technology.md).

These preferences determine which notifications are delivered to the user.

---

# Future Expansion

Potential future capabilities include:

* Multiple portfolio layouts
* Custom portfolio domains
* Public developer profile URLs
* Resume generation
* Activity timeline
* Public achievements
* Contribution statistics

These ideas remain outside the current MVP.

---

# Guiding Principle

A user profile should represent **what a builder creates**, not **how active they are on a social platform**.

Every design decision within this module should reinforce that philosophy.
