# Result Contract

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

## `RecommendationResultDTO`

```ts
interface RecommendationResultDTO {
  userId: string;
  generatedAt: string;               // ISO timestamp
  items: readonly RecommendationItemDTO[];
  diagnostics?: RecommendationDiagnostics;   // only when explicitly requested
}

interface RecommendationItemDTO {
  competition: CompetitionCardDTO;   // the existing, established public shape
  score: number;                     // [0, 1]
  rank: number;                      // 1-based
}
```

`items` is the long-term contract. It reuses `CompetitionCardDTO`
(`next/src/modules/competitions/types/dto.ts`) rather than inventing a
second competition display shape.

## `RecommendationDiagnostics` — debug-only

```ts
interface RecommendationDiagnostics {
  candidatesEvaluated: number;
  rejectedByHardConstraint: number;
  belowThreshold: number;
  returned: number;
  activeDimensions: readonly {
    dimension: DimensionId;
    userStrength: number;
    systemWeight: number;
    effectiveWeight: number;
  }[];
  traces: readonly RecommendationTrace[];
}

interface RecommendationTrace {
  candidateId: string;
  score: number | null;              // null if hard-rejected before scoring
  rejection: RejectionReason | null; // HARD_CONSTRAINT | BELOW_THRESHOLD | BEYOND_TOP_N | null
  contributions: readonly DimensionContribution[];
}
```

Present only when the caller sets `includeDiagnostics: true`
(`RecommendationService.generateForUser`'s options). The internal testing
route always requests it; a future public-facing API would not — internal
implementation detail (exact system weights, per-candidate rejection
reasons) should not leak into a contract external consumers depend on.

The four diagnostic counts are a reconciling partition of
`candidatesEvaluated`:

```text
candidatesEvaluated = rejectedByHardConstraint + belowThreshold
                       + returned + (cleared threshold but beyond Top-N)
```

`pipeline.test.ts` pins this reconciliation.

## Why diagnostics live in the engine's own types, not a separate DTO

`RecommendationDiagnostics` is defined once, in `engine/types.ts`, and
reused directly as `RecommendationResultDTO.diagnostics` — it contains no
Prisma types or Date objects, so it is already DTO-safe. This avoids a
second, parallel diagnostics shape that could drift from what the engine
actually produces.
