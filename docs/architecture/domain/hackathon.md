# Hackathon

> **Status:** Stable
>
> **Version:** 1.0
>
> **Referenced By:** Users, Teams, Projects, Notifications
>
> **Last Updated:** 2026-07-18

---

# Purpose

The Hackathon model represents a hackathon, competition, innovation challenge, or engineering event that builders can discover and participate in.

Hackathons are opportunities that connect builders, teams, and projects.

Unlike Projects or Teams, a Hackathon does not own the work produced during the event.

Instead, it provides context around where that work originated.

---

# Design Philosophy

Hackathons are first-class entities.

They should exist independently of projects and teams.

Projects are created **for** hackathons.

Teams participate **in** hackathons.

The hackathon itself should never become responsible for managing those entities.

This separation allows projects and teams to continue existing after the event has ended.

---

# Responsibilities

The Hackathon model is responsible for:

- Event identity
- Structured event information
- Registration details
- Discoverability
- Documentation
- Media
- External links
- Verification

The Hackathon model is **not** responsible for:

- Managing projects
- Managing teams
- Portfolio generation
- Team recruitment

---

# Identity

Identity uniquely defines a hackathon.

| Field | Required | Unique | Description |
|--------|----------|--------|-------------|
| id | Yes | Yes | Primary identifier. |
| title | Yes | No | Public event title. |
| slug | Yes | Yes | Human-readable URL identifier. |
| shortDescription | Yes | No | Short summary shown throughout the platform. |

---

# Slug

Hackathon URLs follow the format:

```
/hackathons/{slug}
```

Examples:

```
/hackathons/sih-2027

/hackathons/webscape-2027

/hackathons/hack-the-future
```

Rules:

- Unique
- Editable
- Lowercase
- Letters
- Numbers
- Hyphen
- Reserved slugs prohibited

---

# Structured Information

Structured information is stored directly in the database to enable searching, filtering, and recommendations.

Examples include:

| Field | Description |
|------|-------------|
| organizer | Organizer name |
| mode | Online / Offline / Hybrid |
| location | City, State, Country |
| registrationLink | Official registration page |
| website | Official website |
| startDate | Event start |
| endDate | Event end |
| registrationDeadline | Registration deadline |
| minTeamSize | Minimum allowed team members |
| maxTeamSize | Maximum allowed team members |
| prizePool | Optional prize information |

Additional structured fields may be added when they improve discoverability.

---

# Documentation

Every hackathon may optionally contain documentation.

Documentation is stored as Markdown / MDX.

Unlike Projects, documentation is optional.

Examples include:

- Timeline
- Rounds
- Rules
- Requirements
- FAQs
- Venue Information
- Travel Information
- Resources
- Sponsors
- Judging Criteria

Long-form information belongs in documentation.

Structured information belongs in dedicated fields.

---

# Categories

Hackathons belong to one or more categories.

Examples:

- AI
- Web Development
- Cybersecurity
- Healthcare
- Blockchain
- Open Innovation

Categories improve recommendations and discovery.

---

# Technologies

Hackathons may optionally specify preferred or supported technologies.

Examples:

- Flutter
- React
- Python
- TensorFlow

Technologies improve personalized recommendations.

---

# Media

Hackathons support reusable media.

Examples include:

- Banner
- Logo
- Gallery Images

Media is represented through the reusable Media entity.

Videos should be embedded through external platforms rather than uploaded.

---

# Links

Hackathons support multiple external links.

Examples include:

- Official Website
- Registration
- Rulebook
- Discord
- YouTube
- Google Drive
- Brochure

Links are represented using the reusable Link entity.

---

# Organizers

Every hackathon has at least one organizer.

The organizer may be:

- A company
- A college
- A student club
- A community
- An individual

Kizunia stores organizer information independently from platform permissions.

---

# Maintainers

Maintainers are trusted users who can edit the hackathon page.

Maintainers may include:

- Platform administrators
- Verified organizers
- Trusted volunteers

Maintainers do not own the hackathon.

They simply maintain its information on Kizunia.

---

# Community Contributions

Community members may contribute by:

- Suggesting new hackathons
- Suggesting edits
- Reporting outdated information

These contributions never modify public information immediately.

All contributions enter a review workflow.

---

# Review Workflow

Community contributions follow this lifecycle:

```
Draft

↓

Submitted

↓

Pending Review

↓

Approved

↓

Published
```

Only approved changes become publicly visible.

---

# Verification

Hackathons may receive verification.

Examples include:

- Official Event
- Verified Organizer

Verification confirms authenticity rather than popularity.

---

# Visibility

Hackathons support three visibility levels.

- Public
- Unlisted
- Private

Visibility controls discoverability.

---

# Search

Hackathons should be searchable using structured metadata.

Examples include:

- Title
- Organizer
- Categories
- Technologies
- Mode
- Location
- Registration Status
- Event Date

Documentation should not be the primary search source.

---

# Design Decisions

## Why Optional Documentation?

Some hackathons only require basic information.

Others publish extensive rulebooks and timelines.

Making documentation optional keeps the model flexible.

---

## Why Structured Information?

Information such as dates, locations, technologies, and team sizes should remain queryable.

This enables search, filtering, and personalized recommendations.

---

## Why Community Contributions?

Hackathons change frequently.

Allowing the community to suggest additions and edits helps keep the platform accurate while maintaining quality through moderation.

---

## Why Maintainers Instead of Owners?

Hackathons are external events.

Kizunia does not own them.

Instead, trusted users maintain the information displayed on the platform.

---

# Future Expansion

Potential future capabilities include:

- Calendar export
- Reminder subscriptions
- Previous editions
- Organizer profiles
- Sponsor pages
- Automatic deadline reminders

These features should extend the Hackathon model without changing its core philosophy.

---

# Guiding Principle

The Hackathon model should answer one question:

> **What opportunity does this event provide to builders?**

It should never attempt to own projects, teams, or users.

Instead, it serves as the context that connects those entities together.