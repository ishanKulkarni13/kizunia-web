# Hackathon Duplicate Detection

## Purpose

This document describes how Kizunia detects potential duplicate hackathon submissions before they enter the review queue.

Duplicate detection exists to reduce administrative effort, prevent multiple submissions of the same hackathon, and improve the contributor experience.

Rather than rejecting duplicate submissions automatically, the system assists contributors by highlighting similar hackathons before they submit.

The final decision always remains with the contributor and the platform administrators.

---

# Goals

The duplicate detection system aims to:

- Reduce duplicate hackathon submissions.
- Reduce unnecessary moderation work.
- Help contributors discover existing hackathons.
- Redirect duplicate submissions into edit suggestions whenever appropriate.
- Never prevent legitimate contributions.

---

# Design Philosophy

Duplicate detection should assist users rather than block them.

The system should assume good intent.

Contributors should always be allowed to continue if they believe their submission is genuinely different.

False positives are acceptable.

False negatives should become increasingly rare as the system improves.

---

# When Duplicate Detection Runs

Duplicate detection occurs before the final submission step.

The workflow becomes:

```text
Fill Form

↓

Check for Similar Hackathons

↓

Possible Matches

↓

User Decision

↓

Submit
```

Duplicate detection should never interrupt normal editing.

It is only performed when the contributor attempts to continue or submit.

---

# Information Used

The platform may compare multiple fields when searching for similar hackathons.

Examples include:

- Official Name
- Organizer
- Official Website
- Registration Link
- Event Dates
- Location
- Mode
- Short Description

No single field should determine duplication.

Instead, the overall similarity should be considered.

---

# Similarity Strategy

Different fields contribute differently.

For example:

| Field | Importance |
|--------|------------|
| Official Website | Very High |
| Registration Link | Very High |
| Official Name | High |
| Organizer | High |
| Dates | Medium |
| Location | Medium |
| Description | Low |

This weighting may evolve over time as the platform grows.

---

# User Experience

When similar hackathons are detected, the platform should clearly communicate this to the contributor.

Example:

```text
We found similar hackathons.

• Smart India Hackathon 2027
• SIH 2027

Is your submission one of these?
```

The user may then choose one of the following actions.

- View Existing Hackathon
- Suggest an Edit
- Continue Anyway

The platform should never automatically discard a submission.

---

# Suggest Edit

If the contributor identifies an existing hackathon as the intended target, they may switch directly into the edit suggestion workflow.

This avoids creating duplicate review requests.

The existing hackathon should open with a pre-filled edit form.

---

# False Positives

The system may occasionally identify unrelated hackathons as potential duplicates.

This is expected.

Contributors should always have the ability to continue with their submission.

Duplicate detection should assist rather than enforce.

---

# False Negatives

The platform may occasionally fail to identify duplicates.

These cases are expected during the early versions of the platform.

Administrators remain responsible for identifying duplicate submissions during review.

Future improvements should continuously reduce false negatives.

---

# Administrator Experience

Duplicate detection should reduce—not eliminate—duplicate submissions.

Administrators should still be able to identify duplicate proposals during review.

If duplicates reach the review queue, administrators may reject one submission or merge information as appropriate.

---

# Design Decisions

## No Automatic Rejection

Potential duplicates are never rejected automatically.

Only administrators decide whether a submission should become a published hackathon.

---

## User Override

Users always retain the ability to continue with their submission.

The platform should avoid making assumptions when uncertainty exists.

---

## Progressive Improvement

The duplicate detection strategy should improve over time without changing the overall workflow.

Improvements may include:

- Better text similarity
- Smarter organizer matching
- URL normalization
- AI-assisted ranking

These enhancements should improve accuracy while preserving the same user experience.

---

# Out of Scope

This document does not define:

- Database implementation
- Search indexing
- Similarity algorithms
- AI models
- Performance optimizations

Those topics belong in the technical design documentation.

---

# Guiding Principle

Duplicate detection exists to help contributors and administrators.

It should reduce unnecessary work while never preventing legitimate community contributions.