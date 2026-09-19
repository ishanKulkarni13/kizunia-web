/**
 * Admin Technologies - Summary strip
 *
 * Mirrors `admin/competitions/_components/admin-summary-strip.tsx`: plain
 * counts, one row, nothing else. Technology has no "upcoming"-style
 * time-bound state, so this only ever shows total/active/deleted.
 */

import { Card, CardContent } from "@/components/ui/card";

export interface TechnologyAdminSummary {
  readonly total: number;
  readonly active: number;
  readonly deleted: number;
}

export function AdminSummaryStrip({
  summary,
}: {
  summary: TechnologyAdminSummary;
}) {
  const stats: { label: string; value: number }[] = [
    { label: "Total", value: summary.total },
    { label: "Active", value: summary.active },
    { label: "Deleted", value: summary.deleted },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 sm:max-w-md">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="px-4 py-3">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {stat.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
