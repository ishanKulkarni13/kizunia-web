# Hackathon Lifecycle

## Purpose

This document defines the lifecycle states used by Hackathons and Hackathon Suggestions throughout Kizunia Web.

The lifecycle of a Hackathon is different from the lifecycle of a Hackathon Suggestion.

A suggestion represents a community contribution.

A hackathon represents a published event.

These two concepts should never share the same state machine.

---

# Suggestion Lifecycle

Every community suggestion progresses through the following lifecycle.

```text
Draft
    │
    ▼
Under Review
    ├──────────────┐
    ▼              │
Approved           │
                   │
Rejected           │
                   │
Changes Requested──┘
        │
        ▼
Under Review
```

## Draft

The suggestion is being created by the contributor.

Only the contributor can view and edit it.

---

## Under Review

The suggestion has been submitted and is awaiting review.

It becomes read-only until an administrator takes action.

---

## Changes Requested

The administrator has requested additional information or corrections.

The contributor regains editing access.

After updating the submission, it may be submitted again.

---

## Approved

The suggestion has been accepted.

A Hackathon is created using the reviewed information.

The suggestion itself becomes immutable.

---

## Rejected

The suggestion has been rejected.

Rejected suggestions remain visible to the contributor together with the rejection reason.

---

# Hackathon Lifecycle

A published Hackathon follows its own lifecycle.

```text
Upcoming
      │
      ▼
Registration Open
      │
      ▼
Registration Closed
      │
      ▼
Completed
```

Additional states may be introduced in future versions if necessary.

---

# Design Decisions

## Separate Lifecycles

Suggestions and Hackathons represent different business concepts.

Their state machines should remain completely independent.

---

## State Ownership

Only administrators may transition a suggestion from:

- Under Review
- Approved
- Rejected

Contributors may only transition:

- Draft
- Changes Requested

---

# Future Expansion

Future versions may introduce:

- Archived
- Cancelled
- Scheduled Publication
- Draft Hackathons

These should extend the existing lifecycle without replacing it.

---

# Guiding Principle

A suggestion becomes a Hackathon only after approval.

Until then, the published platform should remain unchanged.