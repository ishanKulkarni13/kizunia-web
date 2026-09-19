import type { Prisma } from "@/generated/prisma";

export interface CompetitionSearchOptions {
  where: Prisma.CompetitionWhereInput;

  orderBy: Prisma.CompetitionOrderByWithRelationInput[];

  skip: number;

  take: number;
}

export interface CompetitionSearchResult<T> {
  items: T[];

  pagination: {
    page: number;

    limit: number;

    total: number;

    totalPages: number;

    hasNextPage: boolean;

    hasPreviousPage: boolean;
  };
}