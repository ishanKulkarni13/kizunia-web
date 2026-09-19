"use client";

import { useEffect, useState } from "react";

import { ApiError } from "@/lib/http";
import type { SearchResult } from "@/lib/search/types";
import { ProjectApi } from "../api/project-api";
import { ProjectMineSummaryDto } from "../../backend/dto/output";
import type { ProjectStatus } from "@/generated/prisma";

interface UseMyProjectsParams {
  search?: string;
  status?: ProjectStatus | "ALL";
  page: number;
  pageSize: number;
}

interface UseMyProjectsState {
  items: ProjectMineSummaryDto[];
  pagination: SearchResult<ProjectMineSummaryDto>["pagination"] | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * A plain fetch-on-params-change hook, not a Zustand store — this list's
 * state (filters, page) is naturally request/response and isn't shared with
 * any other component, unlike `useProjectStore`'s single-editor-project
 * state.
 */
export function useMyProjects({
  search,
  status,
  page,
  pageSize,
}: UseMyProjectsParams): UseMyProjectsState {
  const [state, setState] = useState<UseMyProjectsState>({
    items: [],
    pagination: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((previous) => ({
        ...previous,
        isLoading: true,
        error: null,
      }));

      try {
        const result = await ProjectApi.findMine({
          search,
          status: status && status !== "ALL" ? status : undefined,
          page,
          pageSize,
        });

        if (!cancelled) {
          setState({
            items: result.items,
            pagination: result.pagination,
            isLoading: false,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            items: [],
            pagination: null,
            isLoading: false,
            error:
              error instanceof ApiError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "Failed to load your projects.",
          });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [search, status, page, pageSize]);

  return state;
}
