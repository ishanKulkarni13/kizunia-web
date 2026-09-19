/**
 * Admin Competition Suggestions - Table
 *
 * Read-only, unlike `admin-competitions-table.tsx`: every mutation for a
 * suggestion (approve/reject/request changes/asset removal) lives on its own
 * detail/review page, so this table has no row selection, no bulk bar, and
 * no inline editors — just a Server Component rendering what the service
 * already authorized and returned.
 */

import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { CompetitionSuggestionAdminTableDTO } from "@/modules/competitions/backend/suggestion/authorization/dto/suggestion-admin-table.dto";
import { SuggestionStatusBadge } from "@/modules/competitions/components/suggestion/suggestion-status-badge";

function formatDate(date: Date | null): string {
  if (!date) return "—";

  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminSuggestionsTable({
  suggestions,
}: {
  suggestions: readonly CompetitionSuggestionAdminTableDTO[];
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Submitter</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Reviewed</TableHead>
            <TableHead className="text-right">Assets</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {suggestions.map((suggestion) => (
            <TableRow key={suggestion.id}>
              <TableCell className="max-w-64">
                <Link
                  href={`/admin/competition-suggestions/${suggestion.id}`}
                  className="truncate font-medium hover:underline"
                >
                  {suggestion.suggestionTitle}
                </Link>
              </TableCell>

              <TableCell className="max-w-48 truncate text-muted-foreground">
                {suggestion.submitter.name}
                <span className="block text-xs">{suggestion.submitter.email}</span>
              </TableCell>

              <TableCell>
                <SuggestionStatusBadge status={suggestion.status} />
              </TableCell>

              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDate(suggestion.submittedAt)}
              </TableCell>

              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDate(suggestion.reviewedAt)}
              </TableCell>

              <TableCell className="text-right tabular-nums text-muted-foreground">
                {suggestion.assetCount}
              </TableCell>

              <TableCell>
                <Link
                  href={`/admin/competition-suggestions/${suggestion.id}`}
                  className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  Review
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
