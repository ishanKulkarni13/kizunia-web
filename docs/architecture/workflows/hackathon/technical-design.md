# Hackathon Workflow Technical Design

## Purpose

This document records high-level technical decisions behind the Hackathon workflow.

Unlike other workflow documents, this file focuses on architectural decisions rather than user interactions.

It should guide implementation while remaining independent of specific frameworks or technologies.

---

# Workflow Overview

```text
Client

↓

Create Draft

↓

Edit Draft

↓

Submit

↓

Duplicate Detection

↓

Review Queue

↓

Admin Review

↓

Approve

↓

Hackathon Created
```

---

# Drafts

Suggestions should be saved as drafts.

Drafts allow contributors to:

- Continue later.
- Prevent accidental data loss.
- Review information before submission.

---

# Duplicate Detection

Duplicate detection runs before the suggestion enters the review queue.

The backend searches existing hackathons using multiple fields.

Potential matches are returned to the client.

The contributor decides whether to continue.

Duplicate detection never blocks submission.

---

# Review Queue

Submitted suggestions enter a centralized review queue.

The queue should expose enough metadata for administrators to prioritize reviews.

Examples include:

- Submission date
- Contributor
- Duplicate warning
- Completion level

---

# Publishing

Approval should create a brand new Hackathon.

Community suggestions should never directly modify published hackathons.

This keeps published information isolated from unreviewed content.

---

# Notifications

Users should receive notifications whenever their submission changes status.

Examples:

- Submitted
- Changes Requested
- Approved
- Rejected

Notification delivery is handled by the Notification module.

---

# Performance

The workflow should prioritize responsiveness.

Examples:

- Duplicate detection should complete quickly.
- Draft saving should feel instantaneous.
- Review queue should remain paginated.

---

# Future Improvements

Possible future enhancements include:

- Better duplicate detection
- AI-assisted review
- Automatic metadata extraction
- Spam detection
- Bulk moderation
- Organizer workflows

These improvements should build upon the existing workflow rather than replacing it.

---

# Guiding Principle

The workflow should remain simple for contributors while giving administrators enough tools to efficiently maintain a trustworthy hackathon directory.