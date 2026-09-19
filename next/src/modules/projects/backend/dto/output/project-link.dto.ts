import type { LinkType } from "@/generated/prisma";

export interface ProjectLinkDto {
  id: string;

  title: string;

  url: string;

  type: LinkType;

  order: number;
}
