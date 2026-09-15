import { NextRequest } from "next/server";

import { CompetitionController } from "@/modules/competitions/backend/controller";

interface RouteContext {
  params: Promise<{
    slug: string;
  }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext,
) {
  const { slug } = await params;

  return CompetitionController.findPublicBySlug(
    request,
    slug,
  );
}