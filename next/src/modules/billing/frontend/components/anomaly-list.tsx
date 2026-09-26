"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { BillingAdminApi, type AnomalyListParams } from "../../api/billing-admin-api";
import type { AnomalyListDTO } from "../../backend/admin/admin-billing.dto";
import { ANOMALY_TYPES, anomalyHref, errorMessage, formatDate, humanize, userHref } from "./billing-admin-format";

type Status = NonNullable<AnomalyListParams["status"]>;

/**
 * Anomalies: situations that need a human decision, never corrected
 * automatically. Open ones first. Reading is for administrators; resolving is
 * on the detail page, for SUPER_ADMIN.
 */
export function AnomalyList({ initialType, initialStatus }: { initialType?: string; initialStatus?: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus ?? "OPEN");
  const [type, setType] = useState(initialType ?? "");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AnomalyListDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      setData(await BillingAdminApi.listAnomalies({ status, type: type || undefined, page }));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load anomalies."));
    } finally {
      setLoading(false);
    }
  }, [status, type, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="anomaly-status">Status</Label>
          <NativeSelect
            id="anomaly-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as Status);
              setPage(1);
            }}
          >
            <NativeSelectOption value="OPEN">Open</NativeSelectOption>
            <NativeSelectOption value="RESOLVED">Resolved</NativeSelectOption>
            <NativeSelectOption value="ALL">All</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="anomaly-type">Type</Label>
          <NativeSelect
            id="anomaly-type"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">Any type</NativeSelectOption>
            {ANOMALY_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {humanize(value)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      {loading && !data ? (
        <Skeleton className="h-48 w-full" />
      ) : data && data.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No anomalies</EmptyTitle>
            <EmptyDescription>Nothing here needs a human decision.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>User</TableHead>
              <TableHead>First seen</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Seen</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((anomaly) => (
              <TableRow key={anomaly.id}>
                <TableCell>{humanize(anomaly.type)}</TableCell>
                <TableCell>
                  <Badge variant={anomaly.resolvedAt ? "secondary" : "destructive"}>{anomaly.resolvedAt ? "Resolved" : "Open"}</Badge>
                </TableCell>
                <TableCell>
                  {anomaly.userId ? (
                    <Link href={userHref(anomaly.userId)} className="font-mono text-xs underline underline-offset-2">
                      {anomaly.userId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(anomaly.firstSeenAt)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(anomaly.lastSeenAt)}</TableCell>
                <TableCell>{anomaly.occurrences}×</TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline">
                    <Link href={anomalyHref(anomaly.id)}>Open</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={!data.pagination.hasPreviousPage || loading} onClick={() => setPage((current) => current - 1)}>
            Previous
          </Button>
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <Button size="sm" variant="outline" disabled={!data.pagination.hasNextPage || loading} onClick={() => setPage((current) => current + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
