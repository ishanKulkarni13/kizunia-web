# Hackathon Suggestion Workflow

## Purpose

This document defines the complete workflow for how new hackathons are contributed to Kizunia Web by the community.

The primary goal of this workflow is to keep the barrier to contribution as low as possible while ensuring that published hackathon information remains accurate, trustworthy, and well curated.

Rather than relying entirely on platform administrators, Kizunia allows the community to help discover new hackathons while administrators remain responsible for reviewing and publishing submitted information.

---

# Goals

This workflow is designed to achieve several objectives.

- Allow anyone to contribute.
- Minimize the amount of information required.
- Prevent duplicate hackathons.
- Reduce administrative effort.
- Maintain high quality published information.
- Keep contributors informed throughout the review process.

---

# Actors

The workflow currently involves three actors.

## Community User

Any authenticated user may suggest a hackathon.

Community users cannot directly publish or modify hackathons.

---

## Administrator

Administrators review community submissions.

They may:

- Approve
- Reject
- Request Changes

Administrators are responsible for ensuring that published information is accurate.

---

## Platform Owner

The Platform Owner has complete authority over the workflow.

The owner may perform every action available to administrators in addition to configuring and evolving the review process.

---

# Workflow Overview

The complete workflow is illustrated below.

```text
User

↓

Suggest Hackathon

↓

Fill Form

↓

Duplicate Detection

↓

Possible Duplicate?

├── Yes
│       ↓
│ Suggest Edit Instead
│
└── No
        ↓
Save Draft

↓

Submit

↓

Pending Review

↓

Administrator Review

├── Approve
├── Request Changes
└── Reject

↓

Hackathon Published
```

---

# Creating a Suggestion

A user begins by selecting **Suggest a Hackathon**.

The user is presented with a lightweight submission form.

The form should request only information that contributors are reasonably expected to know.

The platform should avoid making contribution unnecessarily difficult.

---

# Drafts

Suggestions are initially stored as drafts.

Drafts allow contributors to:

- Leave the page.
- Continue editing later.
- Review information before submission.

Drafts remain private to their creator.

A draft does not enter the review queue until it is submitted.

---

# Duplicate Detection

Before a suggestion can be submitted, Kizunia performs duplicate detection.

The objective is to reduce duplicate submissions before they reach administrators.

If similar hackathons are found, contributors are informed and encouraged to review existing entries.

Duplicate detection is advisory rather than mandatory.

Users may continue submitting if they believe their hackathon is genuinely different.

The duplicate detection algorithm is documented separately.

---

# Submission

Once satisfied, the contributor submits the suggestion.

Submitting a suggestion changes its state from:

```text
Draft

↓

Submitted
```

Submitted suggestions become read-only until reviewed.

---

# Review Queue

Every submitted suggestion enters the review queue.

Suggestions remain invisible to the public.

Administrators review submissions independently.

Suggestions should never become public without explicit approval.

---

# Review Outcomes

Administrators have three possible decisions.

---

## Approve

The submitted information is accepted.

A new Hackathon is created using the reviewed information.

The suggestion is marked as approved.

---

## Request Changes

The administrator requests additional information or corrections.

Examples include:

- Missing website
- Incorrect dates
- Broken registration link
- Insufficient description

The contributor is notified.

The suggestion becomes editable again.

After modifications it may be submitted once more.

---

## Reject

The suggestion is rejected.

Rejected suggestions remain visible to their creator along with the rejection reason.

Rejected suggestions do not create hackathons.

---

# User Dashboard

Contributors should be able to monitor all of their submissions.

Examples include:

- Draft
- Submitted
- Under Review
- Changes Requested
- Approved
- Rejected

The dashboard provides transparency and reduces uncertainty during the review process.

---

# Notifications

The platform should notify contributors whenever the status of their suggestion changes.

Examples include:

- Submitted successfully
- Under review
- Changes requested
- Approved
- Rejected

Notifications improve transparency and encourage future contributions.

---

# Design Decisions

## Low Barrier to Contribution

The submission process should remain simple.

Contributors should never feel that submitting a hackathon requires extensive effort.

---

## Review Before Publication

Community contributions never modify public data directly.

Every suggestion is reviewed before becoming publicly visible.

---

## Drafts

Drafts allow contributors to gather information over time without losing progress.

---

## Duplicate Detection

Duplicate detection protects administrators from reviewing identical submissions while also helping contributors discover existing hackathons.

Duplicate detection assists contributors but never prevents legitimate submissions.

---

## Transparency

Contributors should always understand:

- the current state of their submission,
- why changes were requested,
- why a submission was rejected.

Transparency builds trust in the review process.

---

# Edge Cases

Examples include:

- Multiple users submitting the same hackathon.
- Registration closing before review.
- Organizer submitting after a community member.
- Website becoming unavailable.
- Submission abandoned in Draft state.

These situations should be handled without compromising the integrity of published information.

---

# Out of Scope

This workflow intentionally does not cover:

- Community edit suggestions
- Organizer edit access
- Verification requests
- Automated moderation
- AI-assisted review

These workflows will be documented separately once they become part of the platform.

---

# Guiding Principle

Suggesting a hackathon should feel as simple as contributing to an open-source project.

The workflow should encourage participation while ensuring that every published hackathon remains accurate, trustworthy, and beneficial to the student community.