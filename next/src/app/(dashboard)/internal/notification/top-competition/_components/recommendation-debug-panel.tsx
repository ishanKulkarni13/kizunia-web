"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ApiError } from "@/lib/http/api-error";
import { RecommendationApi } from "@/modules/recommendations/api/recommendation-api";
import type { RecommendationResultDTO } from "@/modules/recommendations/types/recommendation.dto";

type PanelState =
  | { status: "initial" }
  | { status: "loading" }
  | { status: "success"; result: RecommendationResultDTO }
  | { status: "empty"; result: RecommendationResultDTO }
  | { status: "error"; message: string };

/**
 * Thin client panel for the Phase 0 recommendation engine debug route.
 *
 * Contains no scoring logic — it only calls
 * `RecommendationApi.generateForCurrentUser` (which always targets the
 * caller's own session) and renders whatever `RecommendationResultDTO` (and
 * its `diagnostics`) comes back. See `../page.tsx` for the auth boundary.
 */
export function RecommendationDebugPanel() {
  const [state, setState] = useState<PanelState>({ status: "initial" });

  async function handleGenerate() {
    setState({ status: "loading" });

    try {
      const result = await RecommendationApi.generateForCurrentUser({
        includeDiagnostics: true,
      });

      setState(
        result.items.length === 0
          ? { status: "empty", result }
          : { status: "success", result },
      );
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `${error.code}: ${error.message}`
          : "Something went wrong generating recommendations.";

      toast.error(message);
      setState({ status: "error", message });
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={state.status === "loading"}>
        {state.status === "loading" ? "Generating…" : "Generate recommendations"}
      </Button>

      {state.status === "initial" && (
        <p className="text-sm text-muted-foreground">
          Click the button to run the pipeline for your own account.
        </p>
      )}

      {state.status === "loading" && (
        <div className="space-y-2 rounded-md border p-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {state.status === "error" && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Could not generate recommendations</EmptyTitle>
            <EmptyDescription>{state.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {state.status === "empty" && (
        <>
          <DiagnosticsStrip diagnostics={state.result.diagnostics} />
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon" />
              <EmptyTitle>No recommendations cleared the threshold</EmptyTitle>
              <EmptyDescription>
                Either nothing is currently open for registration, or nothing
                scored high enough. See the counts above.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </>
      )}

      {state.status === "success" && (
        <>
          <DiagnosticsStrip diagnostics={state.result.diagnostics} />
          <div className="space-y-3">
            {state.result.items.map((item) => (
              <Card key={item.competition.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>
                      #{item.rank} — {item.competition.title}
                    </CardTitle>
                    <Badge variant="secondary">
                      score {item.score.toFixed(3)}
                    </Badge>
                  </div>
                  <CardDescription>
                    {item.competition.organizer ?? "Unknown organizer"} ·{" "}
                    {item.competition.status ?? "no status"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DimensionBreakdown
                    competitionId={item.competition.id}
                    diagnostics={state.result.diagnostics}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DiagnosticsStrip({
  diagnostics,
}: {
  diagnostics: RecommendationResultDTO["diagnostics"];
}) {
  if (!diagnostics) return null;

  const cells: { label: string; value: number }[] = [
    { label: "Candidates", value: diagnostics.candidatesEvaluated },
    { label: "Hard-rejected", value: diagnostics.rejectedByHardConstraint },
    { label: "Below threshold", value: diagnostics.belowThreshold },
    { label: "Returned", value: diagnostics.returned },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map((cell) => (
        <Card key={cell.label}>
          <CardHeader className="pb-1">
            <CardDescription>{cell.label}</CardDescription>
            <CardTitle className="text-2xl">{cell.value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function DimensionBreakdown({
  competitionId,
  diagnostics,
}: {
  competitionId: string;
  diagnostics: RecommendationResultDTO["diagnostics"];
}) {
  const trace = diagnostics?.traces.find((t) => t.candidateId === competitionId);

  if (!trace || trace.contributions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No dimension breakdown available.</p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {trace.contributions.map((contribution) => (
        <Badge
          key={contribution.dimension}
          variant={contribution.signal.outcome === "MATCH" ? "default" : "outline"}
        >
          {contribution.dimension}: {contribution.signal.outcome} (
          {contribution.effectiveWeight.toFixed(2)}w)
        </Badge>
      ))}
    </div>
  );
}
