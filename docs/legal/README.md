# Legal Pages

## Implemented

Kizunia provides public, server-rendered App Router pages at:

- `/legal/terms`
- `/legal/privacy`

The routes are outside the authenticated dashboard route group. Their content is source-controlled and rendered without database, session, API, or client-side fetching dependencies.

The shared presentation lives in `next/src/components/legal/`:

- `legal-page.tsx` provides the public shell, metadata presentation, responsive table of contents, anchors, and legal navigation.
- `legal-section.tsx` provides stable section IDs and consistent section typography.

Legal wording is independently editable in `next/src/constants/legal/terms-content.tsx` and `privacy-content.tsx`. The source of truth for legal metadata is `next/src/constants/legal/config.ts`. It currently contains explicit `Not yet configured` placeholders for values that have not been supplied. The static `lastUpdated` value must be intentionally changed when policy wording changes.

The Terms grant Kizunia a limited, non-exclusive, worldwide, royalty-free operational license to intentionally public User Content. This supports public profiles, portfolios, projects, discovery, search, recommendations, previews, feeds, competition displays, and related product surfaces without transferring ownership.

## Future / Not Implemented

The following are intentionally outside this feature and must not be inferred from the pages:

- account and User Content deletion, anonymization, export, or self-service privacy workflows;
- retention schedules, deletion jobs, backup retention, legal holds, and retention exceptions;
- a dedicated cookie/tracking technology audit;
- cookie consent, preference management, or consent storage where legally required;
- processor/subprocessor contracts and data-residency review;
- verified entity/controller name, legal address, governing law, and jurisdiction;
- final legal and privacy contacts and a grievance process; and
- qualified lawyer review before production reliance.

Before final publication, confirm the exact authentication cookie behavior, provider disclosures, location processing, international transfer safeguards, and operational response process for privacy requests. This implementation is a product/legal-document baseline and is not a claim of legal compliance.
