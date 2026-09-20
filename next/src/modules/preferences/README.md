# Preferences Module

## Purpose

Persistence for two independent user preference concepts. Neither is the other, and neither is
collapsed into the other — see
[`docs/project/feature-specification/notification/preferences/README.md`](../../../../docs/project/feature-specification/notification/preferences/README.md).

- **Notification preferences** — which notification types a user wants (`NotificationPreference`,
  one row per `(userId, intent)`). Currently one intent: `TOP_RELEVANT_COMPETITION`, on/off.
- **Competition preferences** — which competitions are relevant to a user (`CompetitionPreference`,
  one row per `(userId, dimension, value)`, weighted `[0, 1]`). Consumed only by the recommendation
  engine's `PreferenceProfileProvider` (`next/src/modules/recommendations/backend/preference-profile.provider.ts`
  → `DbPreferenceProfileProvider`); this module never imports the recommendation engine's `backend/`
  or Prisma-touching code, only its pure `DimensionId` export.

## Folder Structure

```
preferences/
├── README.md
├── index.ts                          public API (schemas, DTOs — NOT backend/, see index.ts)
├── backend/
│   ├── notification-preference.repository.ts
│   ├── notification-preference.service.ts
│   ├── notification-preference.controller.ts
│   ├── competition-preference.repository.ts
│   ├── competition-preference.service.ts
│   └── competition-preference.controller.ts
├── schemas/
│   ├── notification-preference.ts
│   └── competition-preference.ts
└── types/
    ├── notification-preference.dto.ts
    └── competition-preference.dto.ts
```

## Scope

Persistence and validation only. No notification delivery, queue, scheduler, history, or channels —
see `docs/project/feature-specification/notification/decisions/preferences.md` (ND-P-15) for the
persistence decision and `docs/architecture/notifications/persistence/preference-storage.md` for
the full requirements this had to satisfy.

Weight *semantics* (soft vs. hard constraint, dimension dominance) are interpreted by the
recommendation engine (`engine/profile.ts`), not here — this module stores state, it does not
compute relevance.
