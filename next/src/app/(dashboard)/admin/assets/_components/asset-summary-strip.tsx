/**
 * Admin Assets - Summary strip
 *
 * Mirrors admin/technologies' summary strip: plain global counts, one row.
 * Always the unfiltered totals (see AssetAdminSummaryDTO's doc comment) —
 * this never changes when the table below is filtered, by design.
 */

import { Card, CardContent } from "@/components/ui/card";

import type { AssetAdminSummaryDTO } from "@/modules/assets/dto/asset-admin.dto";

export function AssetSummaryStrip({ summary }: { summary: AssetAdminSummaryDTO }) {
  const stats: { label: string; value: number }[] = [
    { label: "Total", value: summary.total },
    { label: "Active", value: summary.active },
    { label: "Detached", value: summary.detached },
    { label: "Deleting", value: summary.deleting },
    { label: "Deleted", value: summary.deleted },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 sm:max-w-2xl">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="px-4 py-3">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{stat.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
