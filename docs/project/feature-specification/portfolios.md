# Portfolios

## Purpose

The Portfolio module represents the public engineering identity of a builder.

Unlike traditional portfolio websites, where users manually create pages describing their work, Kizunia generates portfolios from the user's actual activity across the platform.

Projects, teams, hackathons, contributions, achievements, and collaborations together form the user's engineering portfolio.

The goal is to allow builders to spend their time building rather than maintaining portfolios.

---

# Philosophy

A portfolio should reflect reality.

Rather than asking users to repeatedly enter the same information across multiple platforms, Kizunia automatically builds a portfolio from the work they have already completed.

The portfolio should become richer as the user participates in more projects and collaborates with more people.

---

# Responsibilities

The Portfolio module is responsible for:

* Presenting a builder's work
* Showcasing projects
* Displaying achievements
* Displaying hackathon participation
* Displaying collaborations
* Acting as the user's public profile

The portfolio is not responsible for storing this information.

Instead, it references information from other modules.

---

# Portfolio Structure

A portfolio may include:

* Profile
* About
* Skills
* Interests
* Featured Projects
* Projects
* Teams
* Hackathons
* Achievements
* Social Links
* External Links

Future sections may be introduced without changing the overall philosophy.

---

# Automatic Generation

Most portfolio content should be generated automatically but everything should be customizable.

Examples include:

* Projects
* Teams
* Hackathons
* Contributions
* Technologies
* Statistics


---

# Customization

Although the portfolio is automatically generated, users should be able to customize how it is presented.

Examples include:

* Biography
* Featured Projects
* Featured Skills
* Featured Technologies
* Project Order
* Section Visibility
* Theme (future)
* Accent Color (future)

Customization should affect presentation rather than ownership of the underlying information.

---

# Portfolio Projects

Any active member of a Project — Owner, Maintainer, or Contributor — may
attach that Project to their own Portfolio. This is relationship
management only: the Portfolio never edits the Project's title,
description, visibility, status, members, content, technologies,
categories, badges, testimonials, media, or competitions. It controls
only whether the Project is shown on the Portfolio and whether that
showing is featured.

Users may choose one or more attached projects to highlight as **featured**.
Featuring is independent of ordering — a featured project does not move to
the top of the list; it is marked with a visual indicator instead. Display
order is otherwise fully user-controlled.

If a user is no longer a member of a Project, it immediately stops
appearing anywhere on their Portfolio — in the editor and publicly — even
though the underlying record isn't necessarily deleted right away.

A Project's own visibility/status/deletion rules are always authoritative:
a Portfolio being public never makes a private, draft, unlisted, or deleted
Project publicly visible. The Portfolio owner can still manage (feature,
reorder, remove) their relationship to such a Project in their own editor,
since they remain an active member — only the public rendering is
restricted.

---

# Skills

Skills may be displayed based on:

* User-provided information
* Technologies used across projects

Future versions may automatically suggest skills based on project history.

---

# Achievements

Achievements provide additional context about a builder.

Examples include:

* Hackathon Awards
* Open Source Contributions
* Community Recognition
* Verified Projects
* Featured Projects

Achievements should complement projects rather than replace them.

---

# Social Links

Users may connect external platforms.

Examples include:

* GitHub
* LinkedIn
* Personal Website
* X (Twitter)
* YouTube
* Devpost
* Behance
* Dribbble

These links help visitors explore additional work outside Kizunia.

---

# Statistics

The platform may display engineering statistics such as:

* Projects Created
* Projects Contributed To
* Teams Joined
* Hackathons Participated In
* Technologies Used

---

# Visibility

Users control the visibility of their portfolio.

Visibility levels are:

* Public
* Private

Users may also hide individual sections without hiding the entire
portfolio — this is a separate, per-section presentation toggle
(`hiddenSections`), unrelated to the two-state visibility model above.

A banned user's portfolio is never publicly visible, regardless of its
visibility setting — this is guaranteed by the backend, not the frontend.

Portfolio URLs are based on the owner's username, not a portfolio-specific
identifier. A portfolio may exist before its owner sets a username, but it
is not publicly reachable until they do. Changing or removing a username
changes or breaks the portfolio's public URL — users should be warned
before doing so wherever that change is offered.

---

# Verification

Verification badges appear throughout the portfolio to establish trust and authenticity.

Examples include:

* Kizunia Owner
* Kizunia Administrator
* Verified Organizer
* Verified Project Owner

Verification is contextual.

The purpose of verification is to explain why a user is trusted, not to indicate popularity or status.

---

# Relationships

A portfolio owns its own presentation content (biography, links,
technologies, education, experience, achievements, certifications) and
its Testimonials.

It **references** rather than owns:

* User — the account/identity the Portfolio belongs to
* Projects — respecting each Project's own visibility/status/deletion rules
* Blogs — planned, not yet possible: there is no Blog domain in the platform today
* Teams, Hackathons — future integrations, not yet implemented

Changes made elsewhere on the platform (a Project's visibility changing, for example) should automatically be reflected in what the portfolio is allowed to show.

---

# Public Contact Fields

A portfolio may publish a contact email and phone number that are
intentionally separate from the user's private account email — a builder
can choose to show a different, more public-facing contact address. These
are included in the public portfolio response when set; no other private
account information is exposed there.

---

# Editor API vs Public API

The product guarantees a clear separation between two ways of accessing a
portfolio:

* An **authenticated editor experience**, scoped to the owner, for viewing
  and updating their own portfolio.
* An **anonymous public view**, reachable only by username, that only ever
  returns portfolios meeting every public-visibility condition (public,
  not deleted, owner has a username, owner not banned) and only exposes
  fields that are deliberately part of the public contract — never
  internal/account fields.

The public contract is intentionally designed to be usable by future
third-party integrations (e.g. an external site embedding a builder's
portfolio), though authenticated third-party access (API keys) is not
available yet.

---

# Future Expansion

Potential future enhancements include:

* Portfolio themes
* Custom portfolio layouts
* Custom domains
* Resume generation
* Public portfolio analytics
* Portfolio exports
* Printable resumes
* Portfolio snapshots

These features should build upon the existing portfolio rather than replacing it.

---

# Guiding Principle

A portfolio should be a natural consequence of building.

Users should never feel that maintaining a portfolio is a separate task.

The best way to improve a Kizunia portfolio should simply be to build better projects, collaborate with more people, and participate in meaningful engineering work.
