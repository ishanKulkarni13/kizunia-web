"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectStatus } from "@/generated/prisma";
import { useMyProjects } from "../../hooks/use-my-projects";
import { MyProjectCard } from "./my-project-card";

const STATUS_FILTER_OPTIONS: { value: ProjectStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
];

export function MyProjectsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);

  // Plain local debounce — the shared `useDebouncedValue` in `lib/search`
  // defaults to a 2.5s delay tuned around a URL-navigation search input that
  // gets disabled mid-request; this fetch never disables the input, so that
  // rationale doesn't apply here.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  const { items, pagination, isLoading, error } = useMyProjects({
    search: search || undefined,
    status,
    page,
    pageSize: 20,
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">My Projects</h1>

          <p className="text-sm text-muted-foreground">
            Projects you&apos;re a member of.
          </p>
        </div>

        <Button asChild>
          <Link href="/projects/new">New Project</Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={searchInput}
          onChange={(event) => {
            setPage(1);
            setSearchInput(event.target.value);
          }}
          placeholder="Search your projects..."
          className="max-w-xs"
        />

        <Select
          value={status}
          onValueChange={(value) => {
            setPage(1);
            setStatus(value as ProjectStatus | "ALL");
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <div className="h-28 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-28 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-28 w-full animate-pulse rounded-md bg-muted" />
        </div>
      )}

      {!isLoading && error && (
        <div className="flex min-h-50 items-center justify-center">
          <div className="max-w-md space-y-2 text-center">
            <h2 className="text-lg font-semibold">Unable to load your projects</h2>

            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div className="flex min-h-50 flex-col items-center justify-center gap-3 text-center">
          <h2 className="text-lg font-semibold">No projects yet</h2>

          <p className="max-w-sm text-sm text-muted-foreground">
            You&apos;re not a member of any project yet. Create one to get started.
          </p>

          <Button asChild>
            <Link href="/projects/new">Create your first project</Link>
          </Button>
        </div>
      )}

      {!isLoading && !error && items.length > 0 && (
        <>
          <div className="flex flex-col gap-4">
            {items.map((project) => (
              <MyProjectCard key={project.id} project={project} />
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasPreviousPage}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>

              <span className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>

              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasNextPage}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
