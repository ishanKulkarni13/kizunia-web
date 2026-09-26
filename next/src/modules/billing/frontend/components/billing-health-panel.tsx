"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { BillingHealthDTO } from "../../backend/admin/admin-billing.dto";
import { formatAge, formatDate, humanize, userHref } from "./billing-admin-format";

function Stat({ title, value, hint, tone }: { title: string; value: string | number; hint?: string; tone?: "warn" }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className={tone === "warn" ? "text-2xl text-destructive" : "text-2xl"}>{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

function UserLink({ userId }: { userId: string | null }) {
  if (!userId) return <span className="text-muted-foreground">—</span>;

  return (
    <Link href={userHref(userId)} className="font-mono text-xs underline underline-offset-2">
      {userId}
    </Link>
  );
}

/**
 * The health summary, as the server computed it. Every number is from Kizunia's
 * tables (`GET /api/v1/admin/billing/health`); nothing is derived here beyond
 * layout.
 */
export function BillingHealthPanel({ health, refreshing, onRefresh }: { health: BillingHealthDTO; refreshing: boolean; onRefresh: () => void }) {
  const totalAnomalies = health.openAnomaliesByType.reduce((sum, row) => sum + row.count, 0);
  const totalDue = health.dueBacklog.reduce((sum, row) => sum + row.count, 0);
  const oldestDueAge = Math.max(0, ...health.dueBacklog.map((row) => row.oldestDueAgeSeconds ?? 0));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Provider mode</span>
        <Badge variant={health.providerMode === "DISABLED" ? "secondary" : "default"}>{health.providerMode}</Badge>
        <span className="text-sm text-muted-foreground">Access from</span>
        <Badge variant="outline">{health.expectedMode}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">As of {formatDate(health.generatedAt)}</span>
        <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat title="Due for sync" value={totalDue} hint={totalDue > 0 ? `Oldest ${formatAge(oldestDueAge)}` : "Nothing waiting"} />
        <Stat
          title="Outcome unknown"
          value={health.outcomeUnknown.count}
          hint={health.outcomeUnknown.count > 0 ? `Oldest ${formatAge(health.outcomeUnknown.oldestAgeSeconds)}` : "None"}
          tone={health.outcomeUnknown.count > 0 ? "warn" : undefined}
        />
        <Stat title="Open anomalies" value={totalAnomalies} tone={totalAnomalies > 0 ? "warn" : undefined} />
        <Stat
          title="Cooling down"
          value={health.providerState.filter((s) => s.cooldownActive).length > 0 ? "Yes" : "No"}
          tone={health.providerState.some((s) => s.cooldownActive || s.authFailurePinned) ? "warn" : undefined}
        />
      </div>

      {health.openAnomaliesByType.length > 0 && (
        <Section title="Open anomalies">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.openAnomaliesByType.map((row) => (
                <TableRow key={row.type}>
                  <TableCell>
                    <Link href={`/admin/billing/anomalies?type=${row.type}`} className="underline underline-offset-2">
                      {humanize(row.type)}
                    </Link>
                  </TableCell>
                  <TableCell>{row.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {health.outcomeUnknown.oldest.length > 0 && (
        <Section title="Operations with an unknown outcome (oldest)">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.outcomeUnknown.oldest.map((row) => (
                <TableRow key={row.operationId}>
                  <TableCell>{humanize(row.kind)}</TableCell>
                  <TableCell>{row.providerMode}</TableCell>
                  <TableCell>
                    <UserLink userId={row.userId} />
                  </TableCell>
                  <TableCell>{formatAge(row.ageSeconds)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {health.oldestDue.length > 0 && (
        <Section title="Oldest due subscriptions">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Due since</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Last failure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.oldestDue.map((row) => (
                <TableRow key={row.subscriptionId}>
                  <TableCell>
                    <UserLink userId={row.userId} />
                  </TableCell>
                  <TableCell>{row.providerMode}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(row.syncDueAt)}</TableCell>
                  <TableCell>{row.syncReason ? humanize(row.syncReason) : "—"}</TableCell>
                  <TableCell>{row.syncAttempts}</TableCell>
                  <TableCell>{row.lastSyncFailureClass ? humanize(row.lastSyncFailureClass) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      <Section title="Subscriptions by phase">
        {health.subscriptionsByPhase.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mode</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.subscriptionsByPhase.map((row) => (
                <TableRow key={`${row.providerMode}-${row.phase}`}>
                  <TableCell>{row.providerMode}</TableCell>
                  <TableCell>{humanize(row.phase)}</TableCell>
                  <TableCell>{row.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Provider, webhooks and background jobs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mode</TableHead>
              <TableHead>Cooldown</TableHead>
              <TableHead>Auth pinned</TableHead>
              <TableHead>Orphan scan watermark</TableHead>
              <TableHead>Last webhook</TableHead>
              <TableHead>Last previous-secret match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {health.providerState.map((state) => {
              const webhook = health.webhooks.find((w) => w.providerMode === state.providerMode);

              return (
                <TableRow key={state.providerMode}>
                  <TableCell>{state.providerMode}</TableCell>
                  <TableCell>
                    {state.cooldownActive ? `Until ${formatDate(state.cooldownUntil)} (level ${state.cooldownLevel})` : "Clear"}
                  </TableCell>
                  <TableCell>{state.authFailurePinned ? "Yes" : "No"}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(state.orphanWatermark, "Not started")}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {webhook?.lastReceivedAt ? `${formatDate(webhook.lastReceivedAt)} (${formatAge(webhook.lastReceivedAgeSeconds)} ago)` : "Never"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(webhook?.lastPreviousSecretMatchAt, "Never")}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Runs</TableHead>
              <TableHead>Last error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {health.jobs.map((job) => (
              <TableRow key={job.taskId}>
                <TableCell className="font-mono text-xs">{job.taskId}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(job.lastRunAt, "Never")}</TableCell>
                <TableCell>
                  {job.lastStatus ? <Badge variant={job.lastStatus === "failed" ? "destructive" : "secondary"}>{job.lastStatus}</Badge> : "—"}
                </TableCell>
                <TableCell>{job.runCount}</TableCell>
                <TableCell className="max-w-xs truncate">{job.lastError ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}
