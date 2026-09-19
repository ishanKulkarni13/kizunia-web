/**
 * Admin Competitions - Summary strip
 *
 * Four plain counts, one row, nothing else. This is deliberately not a
 * dashboard: no charts, no percentages, no trends. The table below is the
 * primary UI; this strip exists only to give it a few basic reference
 * numbers and a one-click way to jump to the two states people actually
 * check — active and deleted.
 */

import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { buildSearchHref } from "@/lib/search";
import type { RawSearchParams } from "@/lib/search";

const PATHNAME = "/admin/competitions";

export interface AdminSummary {
  readonly total: number;
  readonly active: number;
  readonly deleted: number;
  readonly upcoming: number;
}

export function AdminSummaryStrip({
  summary,
  params,
}: {
  summary: AdminSummary;
  params: RawSearchParams;
}) {
  const stats: { label: string; value: number; href: string }[] = [
    {
      label: "Total",
      value: summary.total,
      href: buildSearchHref(PATHNAME, params, {
        recordState: "ACTIVE,DELETED",
      }),
    },
    {
      label: "Active",
      value: summary.active,
      href: buildSearchHref(PATHNAME, params, { recordState: undefined }),
    },
    {
      label: "Deleted",
      value: summary.deleted,
      href: buildSearchHref(PATHNAME, params, { recordState: "DELETED" }),
    },
    {
      label: "Upcoming",
      value: summary.upcoming,
      href: buildSearchHref(PATHNAME, params, {
        recordState: undefined,
        statuses: "UPCOMING",
      }),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => (
        <Link key={stat.label} href={stat.href}>
          <Card className="transition-colors hover:border-primary/50">
            <CardContent className="px-4 py-3">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-semibold tabular-nums">
                {stat.value}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
